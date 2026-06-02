"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/dispatcher";
import { emitEvent } from "@/lib/automation/emit";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { sendTeacherApprovalEmail } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError, UnauthenticatedError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";

export type AdminCvSaveResult = { error?: string; success?: boolean };

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) { super(msg, options); this.name = "UserError"; }
}

// Auth at the boundary (ADR-0001): these CV actions gate the P0 teacher
// onboarding review, so they MUST require the admin role here — NOT trust the
// `/admin/*` proxy middleware, which only gates page navigations by URL.
// Server-action POSTs dispatch against whatever page the caller is on, so a
// logged-in teacher could otherwise call `approveCv(ownId)` and self-approve.
// (Audit finding H1.)
async function authPreflight(): Promise<{ actorId: string }> {
  try {
    const { id } = await requireAdmin();
    return { actorId: id };
  } catch (e) {
    if (e instanceof UnauthenticatedError) throw new UserError("غير مسجل الدخول");
    if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
    throw e;
  }
}

type SaveCvInput = {
  teacherId: string;
  bio: string | null;
  bio_en: string | null;
  intro_video_url: string | null;
  specialties: string[];
  languages: string[];
  recitation_standards: string[];
};

const saveCvAsAdminBase = loudAction<SaveCvInput, { message: string }>({
  name: "admin.cv.save",
  severity: "info",
  schema: z.object({
    teacherId: z.string().uuid(),
    bio: z.string().nullable(),
    bio_en: z.string().nullable(),
    intro_video_url: z.string().nullable(),
    specialties: z.array(z.string()),
    languages: z.array(z.string()),
    recitation_standards: z.array(z.string()),
  }),
  audit: {
    table: "teacher_profiles",
    recordId: (i) => i.teacherId,
    action: "UPDATE",
    reasonPrefix: "admin save teacher CV",
  },
  preflight: authPreflight,
  handler: async ({ teacherId, bio, bio_en, intro_video_url, specialties, languages, recitation_standards }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_profiles")
      .update({
        bio,
        bio_en,
        intro_video_url,
        specialties,
        languages,
        recitation_standards,
      })
      .eq("teacher_id", teacherId);
    if (error) throw new UserError("فشل حفظ السيرة الذاتية", { cause: error });

    revalidatePath(`/admin/teachers/cv/${teacherId}`);
    revalidatePath("/admin/teachers/cv");
    revalidatePath("/teacher/cv");
    return { message: "saved" };
  },
});

export async function saveCvAsAdmin(
  teacherId: string,
  _prev: AdminCvSaveResult,
  formData: FormData,
): Promise<AdminCvSaveResult> {
  // Form switched from comma-separated text to multi-checkbox — checkboxes
  // with the same `name` serialize as multiple values, so getAll() returns
  // the array directly. parseCsv() helper is no longer needed here.
  const result = await saveCvAsAdminBase({
    teacherId,
    bio: (formData.get("bio") as string | null)?.trim() || null,
    bio_en: (formData.get("bio_en") as string | null)?.trim() || null,
    intro_video_url: (formData.get("intro_video_url") as string | null)?.trim() || null,
    specialties: (formData.getAll("specialties") as string[]).filter(Boolean),
    languages: (formData.getAll("languages") as string[]).filter(Boolean),
    recitation_standards: (formData.getAll("recitation_standards") as string[]).filter(Boolean),
  });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const approveCvBase = loudAction<{ teacherId: string }, { message: string }>({
  name: "admin.cv.approve",
  // P0 onboarding gate. `warning` matches setUserRoles / createTeacher
  // tier — Sentry capture without paging Telegram on every retry.
  severity: "warning",
  schema: z.object({ teacherId: z.string().uuid() }),
  audit: {
    table: "teacher_profiles",
    recordId: (i) => i.teacherId,
    action: "UPDATE",
    reasonPrefix: "admin approve teacher CV",
  },
  preflight: authPreflight,
  handler: async ({ teacherId }, { actorId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_profiles")
      .update({
        cv_status: "approved",
        cv_reviewed_by: actorId,
        cv_reviewed_at: new Date().toISOString(),
        cv_rejection_reason: null,
      })
      .eq("teacher_id", teacherId);
    if (error) throw new UserError("فشل قبول السيرة الذاتية", { cause: error });

    // Best-effort teacher notification — must not fail the approval.
    try {
      await notify({
        userId: teacherId,
        type: "system",
        title: "تم قبول سيرتك الذاتية",
        body: "تمت الموافقة على سيرتك الذاتية — يمكنك الآن استقبال الطلاب",
        entityType: "teacher_profile",
        entityId: teacherId,
      });
    } catch (err) {
      logError("approveCv: notify failed", err, { tag: "admin-cv" });
    }

    // Fan-out to n8n welcome workflows + Telegram audit trail + congrats
    // email. Each side-effect is best-effort; allSettled means a single
    // failure doesn't block the others.
    const adminCli = createAdminClient();
    const [{ data: profile }, { data: { user: authUser } = { user: null } }] = await Promise.all([
      adminCli.from("profiles").select("full_name").eq("id", teacherId).single<{ full_name: string | null }>(),
      adminCli.auth.admin.getUserById(teacherId),
    ]);
    const teacherEmail = authUser?.email;
    const teacherName = profile?.full_name ?? "";

    await Promise.allSettled([
      emitEvent(
        "teacher.cv_approved",
        "teacher_profile",
        teacherId,
        { teacher_id: teacherId, approved_by: actorId },
        actorId,
      ).catch((err) => logError("approveCv emitEvent failed", err, { tag: "cv-review" })),
      sendTelegramAlert(
        `✅ <b>Teacher CV approved</b>\n\nTeacher: ${teacherName || teacherId}\nApproved by: ${actorId}`,
      ).catch((err) => logError("approveCv telegram failed", err, { tag: "cv-review" })),
      teacherEmail
        ? sendTeacherApprovalEmail({
            to: teacherEmail,
            fullName: teacherName,
            listingUrl: `https://www.furqan.today/teachers#teacher-${teacherId}`,
          }).catch((err) => logError("approveCv approval email failed", err, { tag: "cv-review" }))
        : Promise.resolve(),
    ]);

    revalidatePath("/admin/teachers/cv");
    revalidatePath("/teacher/cv");
    revalidatePath("/teachers");
    revalidatePath("/student/teachers");
    return { message: "approved" };
  },
});

export async function approveCv(teacherId: string): Promise<AdminCvSaveResult> {
  const result = await approveCvBase({ teacherId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const resetCvToPendingBase = loudAction<{ teacherId: string }, { message: string }>({
  name: "admin.cv.reset-to-pending",
  severity: "info",
  schema: z.object({ teacherId: z.string().uuid() }),
  audit: {
    table: "teacher_profiles",
    recordId: (i) => i.teacherId,
    action: "UPDATE",
    reasonPrefix: "admin reset CV to pending review",
  },
  preflight: authPreflight,
  handler: async ({ teacherId }, { actorId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_profiles")
      .update({
        cv_status: "pending_review",
        cv_reviewed_by: null,
        cv_reviewed_at: null,
        cv_rejection_reason: null,
      })
      .eq("teacher_id", teacherId);
    if (error) throw new UserError("فشل إعادة الحالة", { cause: error });

    revalidatePath("/admin/teachers/cv");
    revalidatePath(`/admin/teachers/cv/${teacherId}`);
    revalidatePath(`/admin/teachers/${teacherId}`);
    revalidatePath("/teacher/cv");

    emitEvent("teacher.cv_reset", "teacher_profile", teacherId, { teacher_id: teacherId }, actorId)
      .catch((err) => logError("resetCvToPending emitEvent failed", err, { tag: "cv-review" }));

    return { message: "reset" };
  },
});

export async function resetCvToPending(teacherId: string): Promise<AdminCvSaveResult> {
  const result = await resetCvToPendingBase({ teacherId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

const rejectCvBase = loudAction<{ teacherId: string; reason: string }, { message: string }>({
  name: "admin.cv.reject",
  // P0 onboarding gate (negative path). Same severity as approveCv.
  severity: "warning",
  schema: z.object({
    teacherId: z.string().uuid(),
    reason: z.string().transform((s) => s.trim()).refine((s) => s.length > 0, "يجب ذكر سبب الرفض"),
  }),
  audit: {
    table: "teacher_profiles",
    recordId: (i) => i.teacherId,
    action: "UPDATE",
    reasonPrefix: "admin reject teacher CV",
  },
  preflight: authPreflight,
  handler: async ({ teacherId, reason }, { actorId }) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("teacher_profiles")
      .update({
        cv_status: "rejected",
        cv_reviewed_by: actorId,
        cv_reviewed_at: new Date().toISOString(),
        cv_rejection_reason: reason,
      })
      .eq("teacher_id", teacherId);
    if (error) throw new UserError("فشل رفض السيرة الذاتية", { cause: error });

    // Best-effort teacher notification — must not fail the rejection.
    try {
      await notify({
        userId: teacherId,
        type: "system",
        title: "تم رفض سيرتك الذاتية",
        body: `تم رفض سيرتك الذاتية — السبب: ${reason}`,
        entityType: "teacher_profile",
        entityId: teacherId,
      });
    } catch (err) {
      logError("rejectCv: notify failed", err, { tag: "admin-cv" });
    }

    revalidatePath("/admin/teachers/cv");
    revalidatePath("/teacher/cv");

    emitEvent("teacher.cv_rejected", "teacher_profile", teacherId, { teacher_id: teacherId, reason }, actorId)
      .catch((err) => logError("rejectCv emitEvent failed", err, { tag: "admin-cv" }));

    return { message: "rejected" };
  },
});

export async function rejectCv(teacherId: string, reason: string): Promise<AdminCvSaveResult> {
  // Pre-validate so the Arabic copy from the schema rule reaches the form.
  if (!reason.trim()) return { error: "يجب ذكر سبب الرفض" };
  const result = await rejectCvBase({ teacherId, reason });
  if (!result.ok) return { error: result.error };
  return { success: true };
}
