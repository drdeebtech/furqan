"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { invalidateByTag } from "@vercel/functions";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";

export type ActionResult = { error?: string; success?: boolean; notice?: string };

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string) { super(msg); this.name = "UserError"; }
}

async function adminPreflight(): Promise<{ actorId: string }> {
  try {
    const { id } = await requireAdmin();
    return { actorId: id };
  } catch (e) {
    if (e instanceof ForbiddenError) throw new UserError("غير مصرح");
    throw e;
  }
}

const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function num(formData: FormData, key: string): number | null {
  const v = formData.get(key);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function revalidateTeacher(_teacherId: string) {
  revalidatePath("/admin/teachers/[id]", "page");
  revalidatePath("/admin/teachers");
  revalidatePath("/admin/teachers/cv");
}

// ─── Account (profiles row) ────────────────────────────────────────────

type UpdateAccountInput = {
  teacherId: string;
  fields: TableUpdate<"profiles">;
};

const updateAccountBase = loudAction<UpdateAccountInput, { message: string }>({
  name: "admin.teacher.update-account",
  severity: "warning",
  // Schema kept permissive — public wrapper does the FormData decode and
  // already filters to known columns. Re-validating each field here would
  // duplicate the column allow-list.
  schema: z.object({ teacherId: z.string().uuid(), fields: z.record(z.string(), z.unknown()) }) as unknown as z.ZodType<UpdateAccountInput>,
  audit: {
    table: "profiles",
    recordId: (i) => i.teacherId,
    action: "UPDATE",
    reasonPrefix: "admin update teacher account",
  },
  preflight: adminPreflight,
  handler: async ({ teacherId, fields }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update(fields)
      .eq("id", teacherId);
    if (error) throw new UserError("فشل حفظ بيانات الحساب");
    revalidateTeacher(teacherId);
    return { message: "saved" };
  },
});

export async function updateAccount(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  // `str()` returns `string | null` but TableUpdate generated columns are
  // typed `string | undefined`. Same cast the pre-wrap code used at the
  // .update() call site — moved here so the typed Base contract stays clean.
  const fields = {
    full_name: str(formData, "full_name"),
    full_name_ar: str(formData, "full_name_ar"),
    phone: str(formData, "phone"),
    country: str(formData, "country"),
    timezone: str(formData, "timezone"),
    lang: str(formData, "lang"),
    avatar_url: str(formData, "avatar_url"),
    date_of_birth: str(formData, "date_of_birth"),
    parent_name: str(formData, "parent_name"),
    parent_phone: str(formData, "parent_phone"),
    parent_email: str(formData, "parent_email"),
    is_active: bool(formData, "is_active"),
  } as TableUpdate<"profiles">;
  const result = await updateAccountBase({ teacherId, fields });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const updateEmailBase = loudAction<{ teacherId: string; email: string }, { message: string }>({
  name: "admin.teacher.update-email",
  // Triggers Supabase confirmation email — irreversible-ish (email queued
  // before action result is observable). `warning` so a silent failure
  // gets Sentry capture without paging Telegram on every routine retry.
  severity: "warning",
  schema: z.object({
    teacherId: z.string().uuid(),
    email: z.string().email("البريد الإلكتروني غير صالح"),
  }),
  audit: {
    table: "auth.users",
    recordId: (i) => i.teacherId,
    action: "UPDATE",
    reasonPrefix: "admin queue email change",
  },
  preflight: adminPreflight,
  handler: async ({ teacherId, email }) => {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(teacherId, { email });
    // Pass the raw error through — Supabase's auth error messages
    // ("Email already registered", "Rate limit exceeded") are typically
    // user-actionable. UserError keeps it user-facing instead of the
    // generic "فشل" mapping; auth misconfig still gets captured to Sentry
    // via the envelope.
    if (error) throw new UserError(error.message);
    revalidateTeacher(teacherId);
    // `message` carries the user-visible notice text. The public wrapper
    // remaps it to the existing `notice` field on ActionResult so callers
    // see no shape change.
    return {
      message: "تم إرسال رابط التأكيد إلى البريد الجديد — لن يتغير البريد حتى يضغط المعلم على الرابط.",
    };
  },
});

export async function updateEmail(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const email = str(formData, "email");
  if (!email) return { error: "البريد الإلكتروني مطلوب" };
  const result = await updateEmailBase({ teacherId, email });
  if (!result.ok) return { error: result.error };
  return { success: true, notice: result.message };
}

const uploadTeacherPhotoBase = loudAction<{ teacherId: string; photoFile: File }, { message: string }>({
  name: "admin.teacher.upload-photo",
  severity: "info",
  // File can't sit in zod cleanly — accept it as unknown and validate
  // shape inside the handler. Public wrapper has already done basic
  // type/size checks before we reach here.
  schema: z.object({ teacherId: z.string().uuid(), photoFile: z.unknown() }) as unknown as z.ZodType<{ teacherId: string; photoFile: File }>,
  audit: {
    table: "profiles",
    recordId: (i) => i.teacherId,
    action: "UPDATE",
    reasonPrefix: "admin upload teacher photo",
  },
  preflight: adminPreflight,
  handler: async ({ teacherId, photoFile }) => {
    const adminClient = createAdminClient();
    const ext = photoFile.type === "image/jpeg" ? "jpg" : photoFile.type.split("/")[1];
    const path = `${teacherId}/${Date.now()}.${ext}`;

    const { error: upErr } = await adminClient.storage
      .from("teacher-avatars")
      .upload(path, photoFile, { contentType: photoFile.type, upsert: false });
    if (upErr) throw new UserError("فشل رفع الصورة — يرجى المحاولة مرة أخرى");

    const { data: pub } = adminClient.storage.from("teacher-avatars").getPublicUrl(path);
    const avatarUrl = pub?.publicUrl ?? null;
    if (!avatarUrl) throw new UserError("تعذر إنشاء رابط الصورة");

    // FOLLOW-UP: if this update fails after a successful upload, the
    // storage bucket has an orphaned file. Real fix is a cleanup-on-fail
    // (delete the just-uploaded object). Out of scope for this wrap PR.
    const { error: updErr } = await adminClient
      .from("profiles")
      .update({ avatar_url: avatarUrl } satisfies TableUpdate<"profiles">)
      .eq("id", teacherId);
    if (updErr) throw new UserError("تم رفع الصورة لكن فشل حفظها");

    revalidateTeacher(teacherId);
    revalidatePath("/teachers");
    revalidateTag("teachers-public", "max");
    await invalidateByTag("teachers-public").catch((err) =>
      logError("uploadTeacherPhoto: invalidateByTag failed", err, { tag: "admin-teacher-photo" })
    );
    return { message: "uploaded" };
  },
});

export async function uploadTeacherPhoto(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const photoFile = formData.get("photo");
  if (!(photoFile instanceof File) || photoFile.size === 0) {
    return { error: "يرجى اختيار صورة" };
  }
  if (!ALLOWED_PHOTO_TYPES.includes(photoFile.type)) {
    return { error: "نوع الملف غير مدعوم — JPG / PNG / WebP فقط" };
  }
  if (photoFile.size > MAX_PHOTO_BYTES) {
    return { error: "الملف كبير جدًا — الحد الأقصى 2 ميغابايت" };
  }
  const result = await uploadTeacherPhotoBase({ teacherId, photoFile });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── Teacher profile (teacher_profiles, non-CV fields) ─────────────────

type UpdateTeacherProfileInput = {
  teacherId: string;
  fields: TableUpdate<"teacher_profiles">;
};

const updateTeacherProfileBase = loudAction<UpdateTeacherProfileInput, { message: string }>({
  name: "admin.teacher.update-profile",
  severity: "info",
  schema: z.object({ teacherId: z.string().uuid(), fields: z.record(z.string(), z.unknown()) }) as unknown as z.ZodType<UpdateTeacherProfileInput>,
  audit: {
    table: "teacher_profiles",
    recordId: (i) => i.teacherId,
    action: "UPDATE",
    reasonPrefix: "admin update teacher profile",
  },
  preflight: adminPreflight,
  handler: async ({ teacherId, fields }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_profiles")
      .update(fields)
      .eq("teacher_id", teacherId);
    if (error) throw new UserError("فشل حفظ بيانات المعلم");
    revalidateTeacher(teacherId);
    return { message: "saved" };
  },
});

export async function updateTeacherProfile(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const hourlyRate = num(formData, "hourly_rate");
  const maxActive = num(formData, "max_active_students");
  const fields = {
    hourly_rate: hourlyRate ?? undefined,
    gender: str(formData, "gender"),
    max_active_students: maxActive ?? undefined,
    is_accepting: bool(formData, "is_accepting"),
    is_archived: bool(formData, "is_archived"),
  } as TableUpdate<"teacher_profiles">;
  const result = await updateTeacherProfileBase({ teacherId, fields });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── Ijazas ────────────────────────────────────────────────────────────

type UpsertIjazaInput = {
  teacherId: string;
  id: string | null;
  riwaya: string;
  chain_text: string;
  granted_by: string | null;
  granted_at: string | null;
  document_url: string | null;
};

const upsertIjazaBase = loudAction<UpsertIjazaInput, { message: string }>({
  name: "admin.teacher.upsert-ijaza",
  severity: "info",
  schema: z.object({
    teacherId: z.string().uuid(),
    id: z.string().uuid().nullable(),
    riwaya: z.string().min(1, "الرواية مطلوبة"),
    chain_text: z.string().min(1, "سند الإجازة مطلوب"),
    granted_by: z.string().nullable(),
    granted_at: z.string().nullable(),
    document_url: z.string().nullable(),
  }),
  audit: {
    table: "teacher_ijaza",
    recordId: (i) => i.id ?? `(new for ${i.teacherId})`,
    action: "UPDATE",
    reasonPrefix: "admin upsert teacher ijaza",
  },
  preflight: adminPreflight,
  handler: async ({ teacherId, id, riwaya, chain_text, granted_by, granted_at, document_url }) => {
    const supabase = await createClient();
    if (id) {
      const { error } = await supabase
        .from("teacher_ijaza")
        .update({
          riwaya,
          chain_text,
          granted_by,
          granted_at,
          document_url,
        } satisfies TableUpdate<"teacher_ijaza">)
        .eq("id", id)
        .eq("teacher_id", teacherId);
      if (error) throw new UserError("فشل تحديث الإجازة");
    } else {
      const { error } = await supabase.from("teacher_ijaza").insert({
        teacher_id: teacherId,
        riwaya,
        chain_text,
        granted_by,
        granted_at,
        document_url,
      } satisfies TableInsert<"teacher_ijaza">);
      if (error) throw new UserError("فشل إضافة الإجازة");
    }
    revalidateTeacher(teacherId);
    return { message: id ? "updated" : "inserted" };
  },
});

export async function upsertIjaza(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const input = {
    teacherId,
    id: str(formData, "id"),
    riwaya: str(formData, "riwaya") ?? "",
    chain_text: str(formData, "chain_text") ?? "",
    granted_by: str(formData, "granted_by"),
    granted_at: str(formData, "granted_at"),
    document_url: str(formData, "document_url"),
  };
  // Pre-validate required fields before the Base call so the Arabic
  // copy reaches the form even if zod's lazier path would reformat them.
  if (!input.riwaya) return { error: "الرواية مطلوبة" };
  if (!input.chain_text) return { error: "سند الإجازة مطلوب" };
  const result = await upsertIjazaBase(input);
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const deleteIjazaBase = loudAction<{ teacherId: string; ijazaId: string }, { message: string }>({
  name: "admin.teacher.delete-ijaza",
  // Routine admin correction (e.g. typo fix → re-add). No FK cascade to
  // student data. Keep `info` to avoid Telegram noise on routine edits.
  severity: "info",
  schema: z.object({ teacherId: z.string().uuid(), ijazaId: z.string().uuid() }),
  audit: {
    table: "teacher_ijaza",
    recordId: (i) => i.ijazaId,
    action: "DELETE",
    reasonPrefix: "admin delete teacher ijaza",
  },
  preflight: adminPreflight,
  handler: async ({ teacherId, ijazaId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_ijaza")
      .delete()
      .eq("id", ijazaId)
      .eq("teacher_id", teacherId);
    if (error) throw new UserError("فشل حذف الإجازة");
    revalidateTeacher(teacherId);
    return { message: "deleted" };
  },
});

export async function deleteIjaza(teacherId: string, ijazaId: string): Promise<ActionResult> {
  const result = await deleteIjazaBase({ teacherId, ijazaId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const setIjazaVerifiedBase = loudAction<{ teacherId: string; ijazaId: string; verified: boolean }, { message: string }>({
  name: "admin.teacher.set-ijaza-verified",
  severity: "info",
  schema: z.object({ teacherId: z.string().uuid(), ijazaId: z.string().uuid(), verified: z.boolean() }),
  audit: {
    table: "teacher_ijaza",
    recordId: (i) => i.ijazaId,
    action: "UPDATE",
    reasonPrefix: "admin set ijaza verified",
  },
  preflight: adminPreflight,
  handler: async ({ teacherId, ijazaId, verified }, { actorId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_ijaza")
      .update({
        verified_by: verified ? actorId : null,
        verified_at: verified ? new Date().toISOString() : null,
      } satisfies TableUpdate<"teacher_ijaza">)
      .eq("id", ijazaId)
      .eq("teacher_id", teacherId);
    if (error) throw new UserError("فشل تحديث حالة التوثيق");
    revalidateTeacher(teacherId);
    return { message: verified ? "verified" : "unverified" };
  },
});

export async function setIjazaVerified(
  teacherId: string,
  ijazaId: string,
  verified: boolean,
): Promise<ActionResult> {
  const result = await setIjazaVerifiedBase({ teacherId, ijazaId, verified });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── Availability ──────────────────────────────────────────────────────

export async function upsertAvailability(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      logError("admin/teachers/[id]: auth check failed unexpectedly", e, { tag: "admin-teachers" });
    }
    return { error: "غير مصرح" };
  }

  const id = str(formData, "id");
  const day = num(formData, "day_of_week");
  const startTime = str(formData, "start_time");
  const endTime = str(formData, "end_time");
  const slotDuration = num(formData, "slot_duration") ?? 60;
  const isActive = bool(formData, "is_active");

  if (day === null || day < 0 || day > 6) return { error: "اليوم غير صحيح" };
  if (!startTime || !endTime) return { error: "الوقت مطلوب" };
  if (startTime >= endTime) return { error: "وقت البداية يجب أن يسبق وقت النهاية" };
  if (![30, 45, 60].includes(slotDuration)) return { error: "مدة الفترة غير صحيحة" };

  const supabase = await createClient();

  if (id) {
    const { error } = await supabase
      .from("teacher_availability")
      .update({
        day_of_week: day,
        start_time: startTime,
        end_time: endTime,
        slot_duration: slotDuration,
        is_active: isActive,
      } satisfies TableUpdate<"teacher_availability">)
      .eq("id", id)
      .eq("teacher_id", teacherId);
    if (error) {
      logError("admin upsertAvailability update failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, slotId: id } });
      return { error: "فشل تحديث التوفر" };
    }
  } else {
    const { error } = await supabase.from("teacher_availability").insert({
      teacher_id: teacherId,
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
      slot_duration: slotDuration,
      is_active: isActive,
    } satisfies TableInsert<"teacher_availability">);
    if (error) {
      logError("admin upsertAvailability insert failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, day, startTime, endTime } });
      return { error: error.message.includes("avail_unique") ? "يوجد فترة في نفس اليوم والوقت" : "فشل إضافة التوفر" };
    }
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

export async function deleteAvailability(teacherId: string, slotId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      logError("admin/teachers/[id]: auth check failed unexpectedly", e, { tag: "admin-teachers" });
    }
    return { error: "غير مصرح" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("teacher_availability")
    .delete()
    .eq("id", slotId)
    .eq("teacher_id", teacherId);
  if (error) {
    logError("admin deleteAvailability failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, slotId } });
    return { error: "فشل حذف الفترة" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

// ─── Availability exceptions ───────────────────────────────────────────

export async function upsertException(
  teacherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      logError("admin/teachers/[id]: auth check failed unexpectedly", e, { tag: "admin-teachers" });
    }
    return { error: "غير مصرح" };
  }

  const date = str(formData, "date");
  if (!date) return { error: "التاريخ مطلوب" };

  const supabase = await createClient();
  const { error } = await supabase.from("availability_exceptions").insert({
    teacher_id: teacherId,
    date,
    start_time: str(formData, "start_time"),
    end_time: str(formData, "end_time"),
    is_blocked: bool(formData, "is_blocked"),
    reason: str(formData, "reason"),
  } satisfies TableInsert<"availability_exceptions">);
  if (error) {
    logError("admin upsertException failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, date } });
    return { error: "فشل إضافة الاستثناء" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}

export async function deleteException(teacherId: string, exceptionId: string): Promise<ActionResult> {
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof ForbiddenError)) {
      logError("admin/teachers/[id]: auth check failed unexpectedly", e, { tag: "admin-teachers" });
    }
    return { error: "غير مصرح" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("id", exceptionId)
    .eq("teacher_id", teacherId);
  if (error) {
    logError("admin deleteException failed", error, { tag: "admin-teachers", severity: "warning", metadata: { teacherId, exceptionId } });
    return { error: "فشل حذف الاستثناء" };
  }

  revalidateTeacher(teacherId);
  return { success: true };
}
