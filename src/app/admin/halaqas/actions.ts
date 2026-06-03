"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSessionRoom } from "@/lib/sessions/room-creation";
import { logError } from "@/lib/logger";
import type { TableInsert } from "@/lib/supabase/typed-helpers";
import { emitEvent } from "@/lib/automation/emit";

export interface CreateHalaqaState {
  ok?: boolean;
  error?: string;
  id?: string;
}

interface ProfileRole {
  role: string;
}

/**
 * Verify the caller is admin. Throws on failure.
 */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مسجل الدخول");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<ProfileRole>();
  if (profile?.role !== "admin") throw new Error("صلاحية المسؤول مطلوبة");
}

/**
 * Stage 5 admin halaqa creation. Reads form input, validates, creates a
 * Daily.co halaqa room, inserts a sessions row with session_mode='halaqa'
 * and NULL booking_id, and inserts the teacher as the first
 * session_participants row.
 *
 * Service-role client throughout — Stage 2 RLS denies INSERT on
 * session_participants from authenticated users by design (per the
 * decision from the migration plan critique).
 */
export async function createHalaqa(
  _prev: CreateHalaqaState,
  formData: FormData,
): Promise<CreateHalaqaState> {
  let adminId: string;
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    adminId = user!.id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "غير مصرح" };
  }

  const teacherId = String(formData.get("teacher_id") ?? "").trim();
  const titleAr = String(formData.get("title_ar") ?? "").trim();
  const titleEn = String(formData.get("title_en") ?? "").trim();
  const surahReference = String(formData.get("surah_reference") ?? "").trim() || null;
  const ayahRange = String(formData.get("ayah_range") ?? "").trim() || null;
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const minParticipantsRaw = String(formData.get("min_participants") ?? "").trim();
  const scheduledAtRaw = String(formData.get("scheduled_at") ?? "").trim();
  const durationMinRaw = String(formData.get("duration_min") ?? "").trim();
  const allowRecording = formData.get("allow_recording") === "on";

  if (!teacherId) return { error: "اختر معلماً" };
  if (!titleAr || !titleEn) return { error: "العنوان مطلوب بالعربية والإنجليزية" };
  if (!scheduledAtRaw) return { error: "حدد موعداً" };

  const capacity = Number.parseInt(capacityRaw, 10);
  const minParticipants = Number.parseInt(minParticipantsRaw, 10);
  const durationMin = Number.parseInt(durationMinRaw, 10);
  if (!Number.isFinite(capacity) || capacity < 2 || capacity > 15) {
    return { error: "السعة بين 2 و 15" };
  }
  if (!Number.isFinite(minParticipants) || minParticipants < 1 || minParticipants > capacity) {
    return { error: "الحد الأدنى لا يتجاوز السعة" };
  }
  if (!Number.isFinite(durationMin) || durationMin < 15 || durationMin > 240) {
    return { error: "المدة بين 15 و 240 دقيقة" };
  }

  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) return { error: "تنسيق التاريخ غير صالح" };
  if (scheduledAt.getTime() < Date.now()) return { error: "الموعد في الماضي" };

  // Expiry = scheduled + duration + 30min grace, matching the convention
  // used by the existing private-session room creation.
  const expiresAt = new Date(scheduledAt.getTime() + (durationMin + 30) * 60_000);
  const roomName = `halaqa-${crypto.randomUUID().slice(0, 8)}`;

  let room;
  try {
    room = await createSessionRoom({
      name: roomName,
      mode: "halaqa",
      expiresAt,
      maxParticipants: capacity,
      allowRecording,
    });
  } catch (err) {
    logError("createHalaqa: Daily room creation failed", err, { tag: "halaqa.create" });
    return { error: `فشل إنشاء غرفة الفيديو: ${err instanceof Error ? err.message : "خطأ غير معروف"}` };
  }

  const admin = createAdminClient();

  // Insert the halaqa session row. NULL booking_id is allowed since #76.
  const { data: session, error: sessErr } = await admin
    .from("sessions")
    .insert({
      booking_id: null,
      session_mode: "halaqa",
      scheduled_at: scheduledAt.toISOString(),
      capacity,
      min_participants: minParticipants,
      current_enrollment: 0,
      allow_recording: allowRecording,
      surah_reference: surahReference,
      ayah_range: ayahRange,
      session_topic_ar: titleAr,
      session_topic_en: titleEn,
      daily_room_mode: room.daily_room_mode,
      room_name: roomName,
      room_url: room.url,
      expires_at: expiresAt.toISOString(),
      is_group: true,
      created_via: "manual",
    })
    .select("id")
    .single<{ id: string }>();

  if (sessErr || !session) {
    logError("createHalaqa: sessions insert failed", sessErr, { tag: "halaqa.create" });
    return { error: `فشل حفظ الجلسة: ${sessErr?.message ?? "unknown"}` };
  }

  // Add the teacher as the first session_participants row.
  // RLS allows INSERT only from service_role (Stage 2 design); admin
  // client bypasses RLS so this works.
  const { error: partErr } = await admin
    .from("session_participants")
    .insert({
      session_id: session.id,
      user_id: teacherId,
      role: "teacher",
      attendance_status: "registered",
    } satisfies TableInsert<"session_participants">);

  if (partErr) {
    logError("createHalaqa: teacher participant insert failed", partErr, {
      tag: "halaqa.create",
      metadata: { session_id: session.id, teacher_id: teacherId },
    });
    // Don't roll back — the session row exists and is recoverable;
    // admin can re-add the teacher manually if needed. Returning the
    // error so the form surfaces it loudly.
    return {
      error: `حُفظت الجلسة لكن فشل إضافة المعلم: ${partErr.message}`,
      id: session.id,
    };
  }

  await admin.from("audit_log").insert({
    changed_by: adminId,
    table_name: "sessions",
    record_id: session.id,
    action: "INSERT",
    old_data: null,
    new_data: { session_mode: "halaqa", teacher_id: teacherId },
    reason: `Admin created halaqa session`,
  } satisfies TableInsert<"audit_log">).then(({ error }) => {
    if (error) logError("createHalaqa: audit row failed", error, { tag: "halaqa.create" });
  });

  void emitEvent("halaqa.created", "session", session.id, {
    halaqa_name: titleAr,
    teacher_id: teacherId,
    capacity,
  }, adminId);

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/halaqas");
  return { ok: true, id: session.id };
}
