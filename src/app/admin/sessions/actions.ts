"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { createRoom, deleteRoom, updateRoomMaxParticipants, createObserverToken, DailyApiError } from "@/lib/daily";
import { notify } from "@/lib/notifications/dispatcher";
import { logError, logWarn } from "@/lib/logger";

/* ── Row types for query results ──────────────────────────────────────────── */

interface ProfileRole { role: string }
interface SessionForEnd { id: string; booking_id: string; started_at: string | null; ended_at: string | null; actual_duration: number | null; teacher_joined: boolean; student_joined: boolean }
interface BookingForRoom { id: string; scheduled_at: string; duration_min: number; student_id: string; teacher_id: string }
interface SessionForRecreate { id: string; room_name: string; booking_id: string; expires_at: string | null; room_url: string }
interface BookingSchedule { scheduled_at: string; duration_min: number }
interface BookingParties { student_id: string; teacher_id: string }
interface SessionExisting { id: string }

/* ── helper: verify caller is admin ───────────────────────────────────────── */

async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مسجل الدخول");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()
    .then((r) => ({ data: r.data as ProfileRole | null }));

  if (!profile || !["admin", "moderator"].includes(profile.role)) throw new Error("غير مصرح");
  return user;
}

/* ── forceEndSession ──────────────────────────────────────────────────────── */

export async function forceEndSession(sessionId: string, reason: string) {
  const supabase = await createClient();
  const user = await requireAdmin(supabase);

  /* Fetch session */
  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at, ended_at, actual_duration, teacher_joined, student_joined")
    .eq("id", sessionId)
    .single()
    .then((r) => ({ data: r.data as SessionForEnd | null }));

  if (!session) return { error: "الجلسة غير موجودة" };
  if (session.ended_at) return { error: "الجلسة منتهية بالفعل" };
  if (!session.started_at) return { error: "الجلسة لم تبدأ بعد" };

  const now = new Date().toISOString();
  const actualDuration = Math.round(
    (new Date(now).getTime() - new Date(session.started_at).getTime()) / 60000,
  );

  const oldData = {
    ended_at: session.ended_at,
    actual_duration: session.actual_duration,
  };
  const newData = { ended_at: now, actual_duration: actualDuration };

  /* Order matters: update booking first, session last. The session.ended_at
   * guard above (line 50) makes the session update idempotent on retry, so a
   * failed-booking-then-fresh-attempt path stays consistent. The reverse order
   * traps a partial failure forever — booking stuck in "confirmed" with no
   * way to retry because the session.ended_at guard would block. */
  const { error: bookingErr } = await supabase
    .from("bookings")
    .update({ status: "completed" } satisfies TableUpdate<"bookings">)
    .eq("id", session.booking_id);

  if (bookingErr) return { error: "فشل تحديث حالة الحجز" };

  const { error: updateErr } = await supabase
    .from("sessions")
    .update({ ended_at: now, actual_duration: actualDuration } satisfies TableUpdate<"sessions">)
    .eq("id", sessionId);

  if (updateErr) return { error: "فشل إنهاء الجلسة" };

  /* Audit log */
  await supabase.from("audit_log").insert({
    changed_by: user.id,
    table_name: "sessions",
    record_id: sessionId,
    action: "UPDATE",
    old_data: oldData,
    new_data: newData,
    reason,
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("endSession: audit row failed", r.error, { tag: "admin-sessions" });
  });

  /* Notify teacher + student */
  const { data: booking } = await supabase
    .from("bookings")
    .select("student_id, teacher_id")
    .eq("id", session.booking_id)
    .single()
    .then((r) => ({ data: r.data as BookingParties | null }));

  if (booking) {
    const title = "تم إنهاء الجلسة";
    const body = reason || "تم إنهاء الجلسة بواسطة المسؤول";
    await Promise.all(
      [booking.student_id, booking.teacher_id].map((uid) =>
        notify(uid, "system", title, body, "session", sessionId).catch((err) =>
          logError("notify failed during admin endSession", err, {
            component: "admin.sessions.endSession",
            metadata: { uid, sessionId },
          }),
        ),
      ),
    );
  }

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/sessions/live");
  return { success: true };
}

/* ── adminCreateRoom ──────────────────────────────────────────────────────── */

export async function adminCreateRoom(bookingId: string) {
  const supabase = await createClient();
  const user = await requireAdmin(supabase);

  /* Fetch booking */
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_min, student_id, teacher_id")
    .eq("id", bookingId)
    .single()
    .then((r) => ({ data: r.data as BookingForRoom | null }));

  if (!booking) return { error: "الحجز غير موجود" };

  /* Check existing session */
  const { data: existing } = await supabase
    .from("sessions")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle()
    .then((r) => ({ data: r.data as SessionExisting | null }));

  if (existing) return { error: "يوجد جلسة لهذا الحجز بالفعل" };

  /* Create Daily room */
  const roomName = `furqan-${crypto.randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(
    new Date(booking.scheduled_at).getTime() + (booking.duration_min + 30) * 60 * 1000,
  );

  let room;
  try {
    room = await createRoom(roomName, expiresAt);
  } catch (err) {
    logError("createSession: createRoom failed", err, { tag: "admin-sessions" });
    return { error: "فشل إنشاء غرفة الفيديو" };
  }

  /* Insert session */
  const { error: insertErr } = await supabase.from("sessions").insert({
    booking_id: bookingId,
    room_name: room.name,
    room_url: room.url,
    expires_at: expiresAt.toISOString(),
    created_via: "manual",
  } satisfies TableInsert<"sessions">);

  if (insertErr) return { error: "فشل إنشاء الجلسة" };

  /* Audit log */
  await supabase.from("audit_log").insert({
    changed_by: user.id,
    table_name: "sessions",
    record_id: bookingId,
    action: "INSERT",
    old_data: null,
    new_data: { room_name: room.name, room_url: room.url, created_via: "manual" },
    reason: "إنشاء غرفة يدوي بواسطة المسؤول",
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("createRoomManual: audit row failed", r.error, { tag: "admin-sessions" });
  });

  revalidatePath("/admin/sessions");
  return { success: true };
}

/* ── adminRecreateRoom ────────────────────────────────────────────────────── */

export async function adminRecreateRoom(sessionId: string) {
  const supabase = await createClient();
  const user = await requireAdmin(supabase);

  /* Fetch session */
  const { data: session } = await supabase
    .from("sessions")
    .select("id, room_name, booking_id, expires_at, room_url")
    .eq("id", sessionId)
    .single()
    .then((r) => ({ data: r.data as SessionForRecreate | null }));

  if (!session) return { error: "الجلسة غير موجودة" };

  /* Fetch booking for duration */
  const { data: booking } = await supabase
    .from("bookings")
    .select("scheduled_at, duration_min")
    .eq("id", session.booking_id)
    .single()
    .then((r) => ({ data: r.data as BookingSchedule | null }));

  if (!booking) return { error: "الحجز غير موجود" };

  /* Try to delete old room. 404 means it's already gone — totally fine.
   * Anything else (5xx, network failure) is a real Daily.co problem the
   * operator should know about, even though we keep recreating below. */
  try {
    await deleteRoom(session.room_name);
  } catch (err) {
    if (err instanceof DailyApiError && err.status === 404) {
      logWarn("daily.co: deleteRoom 404 — room already gone, continuing", {
        tag: "admin-sessions", roomName: session.room_name,
      });
    } else {
      logError("daily.co: deleteRoom failed (continuing with recreate)", err, {
        tag: "admin-sessions", roomName: session.room_name,
      });
    }
  }

  /* Create new room */
  const newRoomName = `furqan-${crypto.randomUUID().replace(/-/g, "")}`;
  const newExpiresAt = new Date(Date.now() + (booking.duration_min + 30) * 60 * 1000);

  let room;
  try {
    room = await createRoom(newRoomName, newExpiresAt);
  } catch (err) {
    logError("recreateRoom: createRoom failed", err, { tag: "admin-sessions" });
    return { error: "فشل إنشاء غرفة الفيديو الجديدة" };
  }

  const oldData = {
    room_name: session.room_name,
    room_url: session.room_url,
    expires_at: session.expires_at,
  };

  const newData = {
    room_name: room.name,
    room_url: room.url,
    expires_at: newExpiresAt.toISOString(),
  };

  /* Update session */
  const { error: updateErr } = await supabase
    .from("sessions")
    .update({
      room_name: room.name,
      room_url: room.url,
      expires_at: newExpiresAt.toISOString(),
    } satisfies TableUpdate<"sessions">)
    .eq("id", sessionId);

  if (updateErr) return { error: "فشل تحديث الجلسة" };

  /* Audit log */
  await supabase.from("audit_log").insert({
    changed_by: user.id,
    table_name: "sessions",
    record_id: sessionId,
    action: "UPDATE",
    old_data: oldData,
    new_data: newData,
    reason: "إعادة إنشاء غرفة بواسطة المسؤول",
  } satisfies TableInsert<"audit_log">).then((r) => {
    if (r.error) logError("recreateRoom: audit row failed", r.error, { tag: "admin-sessions" });
  });

  revalidatePath("/admin/sessions");
  return { success: true };
}

/* ── joinAsObserver ─────────────────────────────────────────────────────── */

interface SessionForObserve { id: string; booking_id: string; room_name: string; room_url: string; expires_at: string | null; is_observable: boolean; ended_at: string | null }

export async function joinAsObserver(sessionId: string) {
  const supabase = await createClient();
  const user = await requireAdmin(supabase);

  // Fetch session
  const { data: session } = await supabase
    .from("sessions")
    .select("id, booking_id, room_name, room_url, expires_at, is_observable, ended_at")
    .eq("id", sessionId)
    .single()
    .then(r => ({ data: r.data as SessionForObserve | null }));

  if (!session) return { error: "الجلسة غير موجودة" };
  if (session.ended_at) return { error: "الجلسة منتهية" };
  if (!session.is_observable) return { error: "هذه الجلسة غير قابلة للمراقبة" };

  // Bump max participants to 3
  try {
    await updateRoomMaxParticipants(session.room_name, 3);
  } catch (err) {
    logError("joinAsObserver: updateRoomMaxParticipants failed", err, { tag: "admin-sessions" });
    return { error: "فشل تحديث إعدادات الغرفة" };
  }

  // Generate observer token
  const expiresAt = session.expires_at ? new Date(session.expires_at) : new Date(Date.now() + 2 * 60 * 60 * 1000);
  let token: string;
  try {
    token = await createObserverToken(session.room_name, "مراقب", expiresAt);
  } catch (err) {
    logError("joinAsObserver: createObserverToken failed", err, { tag: "admin-sessions" });
    return { error: "فشل إنشاء رمز المراقبة" };
  }

  // Record observer
  const { error: obsSessionErr } = await supabase.from("sessions").update({
    admin_observer_id: user.id,
    observer_joined_at: new Date().toISOString(),
  } satisfies TableUpdate<"sessions">).eq("id", sessionId);

  if (obsSessionErr) return { error: "فشل تسجيل المراقب على الجلسة" };

  const { error: obsInsertErr } = await supabase.from("session_observers").insert({
    session_id: sessionId,
    observer_id: user.id,
    joined_at: new Date().toISOString(),
  } satisfies TableInsert<"session_observers">);

  if (obsInsertErr) return { error: "فشل إنشاء سجل المراقبة" };

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/sessions/live");
  return { success: true, token, roomUrl: session.room_url };
}
