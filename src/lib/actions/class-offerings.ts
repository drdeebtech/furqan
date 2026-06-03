"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";
import { selectActivePackage, debitPackage } from "@/lib/domains/package/ledger";
import { emitEvent } from "@/lib/automation/emit";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import type { SessionType } from "@/types/database";

const VALID_TYPES: ReadonlySet<SessionType> = new Set([
  "hifz", "muraja", "tajweed", "tilawa", "qiraat", "tafsir", "combined", "other",
]);

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

interface CreateInput {
  title: string;
  description?: string | null;
  scheduled_at: string;          // ISO timestamp
  duration_min: number;
  session_type: string;
  capacity: number;
  price_usd: number;
}

/**
 * Teacher publishes a group-class offering. Students browse + self-enroll
 * in Phase 3. RLS already restricts access to the publishing teacher; we
 * still validate inputs here so bad data never lands in the table.
 * Returns extra `id` field — kept as manual pattern with logError.
 */
export async function createOffering(input: CreateInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  const title = input.title?.trim() ?? "";
  if (title.length < 1 || title.length > 200) return { error: "العنوان مطلوب ولا يتجاوز 200 حرف" };
  if (!VALID_TYPES.has(input.session_type as SessionType)) return { error: "نوع الجلسة غير صالح" };
  if (!Number.isInteger(input.duration_min) || input.duration_min < 15 || input.duration_min > 240) {
    return { error: "المدة يجب أن تكون بين 15 و 240 دقيقة" };
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 2 || input.capacity > 20) {
    return { error: "السعة يجب أن تكون بين 2 و 20 طالباً" };
  }
  if (typeof input.price_usd !== "number" || input.price_usd < 0) {
    return { error: "السعر غير صالح" };
  }
  const scheduledMs = Date.parse(input.scheduled_at);
  if (Number.isNaN(scheduledMs)) return { error: "تاريخ الجلسة غير صالح" };
  if (scheduledMs < Date.now() - 60_000) return { error: "لا يمكن جدولة جلسة في الماضي" };

  const { data, error } = await supabase
    .from("class_offerings")
    .insert({
      teacher_id: user.id,
      title,
      description: input.description?.trim() || null,
      scheduled_at: input.scheduled_at,
      duration_min: input.duration_min,
      session_type: input.session_type as SessionType,
      capacity: input.capacity,
      price_usd: input.price_usd,
      status: "open",
    } satisfies TableInsert<"class_offerings">)
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    logError("createOffering insert failed", error, { tag: "class-offerings", metadata: { userId: user.id } });
    return { error: "فشل إنشاء الجلسة الجماعية — " + (error?.message ?? "خطأ غير معروف") };
  }

  revalidatePath("/teacher/classes");
  return { success: true as const, id: data.id };
}

interface UpdateInput extends Partial<CreateInput> {
  status?: "open" | "full" | "confirmed" | "cancelled" | "completed";
}

export const updateOffering = loudAction<{ id: string; patch: UpdateInput }, void>({
  name: "class-offerings.updateOffering",
  handler: async ({ id, patch }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");

    const { data: existing } = await supabase
      .from("class_offerings")
      .select("id, teacher_id, status")
      .eq("id", id)
      .single<{ id: string; teacher_id: string; status: string }>();
    if (!existing) throw new UserError("الجلسة الجماعية غير موجودة");
    if (existing.teacher_id !== user.id) throw new UserError("ليست جلستك");
    if (existing.status === "completed" || existing.status === "cancelled") {
      throw new UserError("لا يمكن تعديل جلسة منتهية أو ملغاة");
    }

    // Build a tight update payload — only fields actually provided.
    const update: TableUpdate<"class_offerings"> = {};
    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (t.length < 1 || t.length > 200) throw new UserError("العنوان مطلوب");
      update.title = t;
    }
    if (patch.description !== undefined) update.description = patch.description?.trim() || null;
    if (patch.scheduled_at !== undefined) {
      const ms = Date.parse(patch.scheduled_at);
      if (Number.isNaN(ms)) throw new UserError("تاريخ غير صالح");
      update.scheduled_at = patch.scheduled_at;
    }
    if (patch.duration_min !== undefined) {
      if (!Number.isInteger(patch.duration_min) || patch.duration_min < 15 || patch.duration_min > 240) {
        throw new UserError("المدة 15..240 دقيقة");
      }
      update.duration_min = patch.duration_min;
    }
    if (patch.session_type !== undefined) {
      if (!VALID_TYPES.has(patch.session_type as SessionType)) throw new UserError("نوع غير صالح");
      update.session_type = patch.session_type as SessionType;
    }
    if (patch.capacity !== undefined) {
      if (!Number.isInteger(patch.capacity) || patch.capacity < 2 || patch.capacity > 20) {
        throw new UserError("السعة 2..20");
      }
      update.capacity = patch.capacity;
    }
    if (patch.price_usd !== undefined) {
      if (typeof patch.price_usd !== "number" || patch.price_usd < 0) throw new UserError("السعر غير صالح");
      update.price_usd = patch.price_usd;
    }
    if (patch.status !== undefined) update.status = patch.status;

    const { error } = await supabase
      .from("class_offerings")
      .update(update)
      .eq("id", id);
    if (error) throw new UserError("فشل التعديل", { cause: error });

    revalidatePath("/teacher/classes");
    revalidatePath(`/teacher/classes/${id}`);
  },
});

/**
 * Student self-enrolls in an open class offering.
 *
 * Behaviour:
 *  - Auth required; the caller becomes the enrolling student.
 *  - Offering must exist and have status = 'open'.
 *  - Can't enroll twice (an existing booking with class_offering_id =
 *    offeringId for this student blocks).
 *  - Capacity check: if the next enrollment would meet the capacity, the
 *    offering transitions to 'full' so it stops appearing in the browse list.
 *  - Each student pays full price / spends own credit (existing pricing).
 *    We deduct one credit from their active package the same way Phase 1's
 *    addStudentToSession does. If no active package, we still create the
 *    booking and flag billing reconciliation in the notes.
 *  - Each enrollment creates a fresh `bookings` row with the offering's
 *    teacher_id, scheduled_at, duration, type, and price. The booking is
 *    auto-confirmed because the teacher already published the slot —
 *    enrollment IS confirmation. session_id stays NULL until the booking
 *    workflow creates the actual sessions row at start time.
 * Returns extra `bookingId` field — kept as manual pattern with logError.
 */
export async function enrollInOffering(
  offeringId: string,
): Promise<{ success?: true; bookingId?: string; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Use the user-context client so RLS confirms the offering is currently
  // visible to a student (status in ('open','full','confirmed')). We refuse
  // to enroll into anything but 'open' below.
  const { data: offering } = await supabase
    .from("class_offerings")
    .select("id, teacher_id, scheduled_at, duration_min, session_type, capacity, price_usd, status")
    .eq("id", offeringId)
    .single<{
      id: string; teacher_id: string; scheduled_at: string;
      duration_min: number; session_type: SessionType; capacity: number;
      price_usd: number; status: string;
    }>();
  if (!offering) return { error: "الجلسة الجماعية غير موجودة" };
  if (offering.status !== "open") return { error: "لا يمكن التسجيل في هذه الجلسة الآن" };
  if (Date.parse(offering.scheduled_at) < Date.now()) {
    return { error: "موعد الجلسة في الماضي" };
  }
  if (offering.teacher_id === user.id) {
    return { error: "لا يمكنك التسجيل في جلستك الخاصة" };
  }

  // Idempotency: refuse a second enrollment by the same student.
  const { data: existing } = await supabase
    .from("bookings")
    .select("id")
    .eq("class_offering_id", offeringId)
    .eq("student_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return { error: "أنت مُسجَّل بالفعل في هذه الجلسة" };

  // Count current enrollment under RLS — students see only their own
  // bookings, so the count we get back is "everyone we can see" which is
  // 0 or 1 (their own). To get the true count we need a service-role
  // round-trip. Reuse the same admin-client pattern as Phase 1.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  const { count: enrolledCount } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("class_offering_id", offeringId)
    .is("deleted_at", null);
  if ((enrolledCount ?? 0) >= offering.capacity) {
    // Race: someone filled the seat between the page render and this call.
    // Flip the offering to 'full' so the next reader sees it correctly.
    await admin.from("class_offerings").update({ status: "full" } satisfies TableUpdate<"class_offerings">).eq("id", offeringId);
    return { error: "وصلت الجلسة للحد الأقصى — حاول التسجيل في جلسة أخرى" };
  }

  // Try to deduct a package credit; same pattern as addStudentToSession.
  let creditNote = "";
  let studentPackageId: string | null = null;
  const activePkg = await selectActivePackage(admin, user.id);

  if (activePkg) {
    studentPackageId = activePkg.id;
    try {
      const debit = await debitPackage(admin, activePkg.id);
      if (!debit.ok && debit.reason === "error") {
        creditNote = `[deduct-failed: ${debit.message}] `;
        logError("enrollInOffering: deduct_package_session RPC error", new Error(debit.message), {
          tag: "class-offerings", metadata: { offeringId, studentId: user.id, packageId: activePkg.id },
        });
        return { error: "تعذر خصم رصيد الباقة. حاول مرة أخرى أو تواصل مع الدعم." };
      }
      if (!debit.ok && debit.reason === "exhausted") {
        creditNote = "[package-expired-or-exhausted] ";
        return { error: "هذه الباقة منتهية أو مستهلكة ولا يمكن استخدامها للتسجيل." };
      }
    } catch (e) {
      creditNote = creditNote || "[deduct-threw] ";
      logError("enrollInOffering: deduct_package_session call failed", e, {
        tag: "class-offerings", metadata: { offeringId, studentId: user.id, packageId: activePkg.id },
      });
      return { error: "خطأ في معالجة الباقة. حاول مرة أخرى أو تواصل مع الدعم." };
    }
  } else {
    creditNote = "[no-active-package] ";
  }

  const { data: newBooking, error: insertErr } = await admin
    .from("bookings")
    .insert({
      student_id: user.id,
      teacher_id: offering.teacher_id,
      scheduled_at: offering.scheduled_at,
      duration_min: offering.duration_min,
      session_type: offering.session_type,
      amount_usd: offering.price_usd,
      rate_snapshot: offering.price_usd,
      tax_amount: 0,
      tax_rate: 0,
      status: "confirmed",
      teacher_confirmed: true,
      teacher_confirmed_at: new Date().toISOString(),
      created_by: user.id,
      class_offering_id: offeringId,
      student_package_id: studentPackageId,
      notes: `${creditNote}Self-enrolled in group class ${offeringId.slice(0, 8)}`,
    } satisfies TableInsert<"bookings">)
    .select("id")
    .single<{ id: string }>();

  if (insertErr || !newBooking) {
    logError("enrollInOffering: bookings insert failed", insertErr, {
      tag: "class-offerings", metadata: { offeringId, studentId: user.id },
    });
    return { error: "فشل إنشاء الحجز — " + (insertErr?.message ?? "خطأ غير معروف") };
  }

  // After this insert, transition to 'full' if we just took the last seat.
  if ((enrolledCount ?? 0) + 1 >= offering.capacity) {
    await admin.from("class_offerings").update({ status: "full" } satisfies TableUpdate<"class_offerings">).eq("id", offeringId);
  }

  await admin.from("audit_log").insert({
    changed_by: user.id,
    table_name: "bookings",
    record_id: newBooking.id,
    action: "INSERT",
    old_data: null,
    new_data: { class_offering_id: offeringId, student_id: user.id },
    reason: `Student self-enrolled in offering ${offeringId.slice(0, 8)}`,
  } satisfies TableInsert<"audit_log">).then(({ error }) => {
    if (error) logError("class-offerings.enroll: audit row failed", error, { tag: "class-offerings" });
  });

  await emitEvent("booking.confirmed", "bookings", newBooking.id, {
    student_id: user.id,
    teacher_id: offering.teacher_id,
    class_offering_id: offeringId,
  }).catch((err) =>
    logError("enrollInOffering: emitEvent booking.confirmed failed", err, {
      tag: "class-offerings",
      metadata: { bookingId: newBooking.id, studentId: user.id },
    })
  );

  revalidatePath("/student/classes");
  revalidatePath("/student/dashboard");
  revalidatePath("/student/sessions");
  return { success: true as const, bookingId: newBooking.id };
}

export const cancelOffering = loudAction<{ id: string; reason?: string }, void>({
  name: "class-offerings.cancelOffering",
  handler: async ({ id, reason }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");

    const { data: existing } = await supabase
      .from("class_offerings")
      .select("id, teacher_id, status")
      .eq("id", id)
      .single<{ id: string; teacher_id: string; status: string }>();
    if (!existing) throw new UserError("الجلسة الجماعية غير موجودة");
    if (existing.teacher_id !== user.id) throw new UserError("ليست جلستك");
    if (existing.status === "completed" || existing.status === "cancelled") {
      throw new UserError("لا يمكن تعديل جلسة منتهية أو ملغاة");
    }

    const { error } = await supabase
      .from("class_offerings")
      .update({ status: "cancelled" } satisfies TableUpdate<"class_offerings">)
      .eq("id", id);
    if (error) throw new UserError("فشل إلغاء الجلسة", { cause: error });

    if (reason) {
      const { error: descErr } = await supabase
        .from("class_offerings")
        .update({ description: `[CANCELLED] ${reason}` } satisfies TableUpdate<"class_offerings">)
        .eq("id", id);
      if (descErr) {
        logError("class-offerings cancel description update failed", descErr, { tag: "class-offerings" });
      }
    }

    revalidatePath("/teacher/classes");
    revalidatePath(`/teacher/classes/${id}`);
  },
});
