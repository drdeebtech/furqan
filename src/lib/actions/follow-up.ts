"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ReviewHorizon } from "@/lib/constants";
import { logError } from "@/lib/logger";
import type { HomeworkStatus } from "@/types/database";
import { loudAction } from "@/lib/actions/loud";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";
import {
  gradeFollowUpSchema,
  editFollowUpUpdatesSchema,
} from "@/lib/actions/follow-up-schemas";
import {
  createFollowUp as createFollowUpDomain,
  markStudentReady as markStudentReadyDomain,
  gradeFollowUp as gradeFollowUpDomain,
} from "@/lib/domains/follow-up/actions";
import { editFollowUp as editFollowUpDomain, deleteFollowUp as deleteFollowUpDomain } from "@/lib/domains/follow-up/manage";
import type { FollowUpActor } from "@/lib/domains/follow-up/types";
import type { CapturedError } from "@/lib/domains/progress/types";
import { validateHomeworkRange } from "@/lib/domains/progress/validation";
import { UserError } from "@/lib/actions/user-error";

/**
 * Follow-up write surface — route adapters.
 *
 * Per ADR-0002, these are thin `loudAction`-wrapped boundaries:
 *   1. authenticate + resolve the role into a `FollowUpActor`,
 *   2. parse FormData / scalar arguments into structured input,
 *   3. delegate the actual write to `@/lib/domains/follow-up`,
 *   4. `revalidatePath(...)` the affected surfaces.
 *
 * The domain functions own the ownership/state guards, DB writes,
 * notifications, auto-regen, audit rows, and the `homework.*` events. The
 * `loudAction` wrapper keeps the audit envelope + Sentry/Telegram plumbing
 * unchanged at the boundary.
 *
 * Domain language note: user-facing copy says "follow-up" / "متابعة";
 * the `homework_assignments` table name is internal.
 */

// ─── Auth helpers (route boundary — resolve the actor) ───────────────────────

async function teacherOrAboveActor(): Promise<FollowUpActor> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || !["admin", "teacher"].includes(profile.role)) {
    throw new UserError("غير مصرح");
  }
  return { id: user.id, isAdmin: profile.role === "admin" };
}

async function studentActor(): Promise<FollowUpActor> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");
  return { id: user.id, isAdmin: false };
}

async function anyAuthedActor(): Promise<FollowUpActor> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مصرح");
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id)
    .single<{ role: string }>();
  return { id: user.id, isAdmin: profile?.role === "admin" };
}

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");
  return user.id;
}

function revalidateFollowUpPaths() {
  revalidatePath("/teacher/follow-up");
  revalidatePath("/teacher/talqeen");
  revalidatePath("/teacher/sessions");
  revalidatePath("/student/follow-up");
  revalidatePath("/student/dashboard");
  revalidatePath("/student/sessions");
  revalidatePath("/admin/follow-up");
  revalidatePath("/admin/follow-up/grade");
  revalidatePath("/admin/dashboard");
}

// ─── 1. Create Follow-up ─────────────────────────────────────────────────────

type CreateFollowUpInput = {
  booking_id: string;
  student_id: string;
  session_id: string | null;
  homework_type: string;
  title: string;
  description: string | null;
  surah_number: number | null;
  ayah_start: number | null;
  ayah_end: number | null;
  pages_count: number | null;
  due_date: string | null;
  review_horizon: ReviewHorizon;
};

const createFollowUpBase = loudAction<CreateFollowUpInput, { message: string }>({
  name: "homework.create",
  severity: "info",
  schema: z.object({
    booking_id: z.string(),
    student_id: z.string(),
    session_id: z.string().nullable(),
    homework_type: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    surah_number: z.number().nullable(),
    ayah_start: z.number().nullable(),
    ayah_end: z.number().nullable(),
    pages_count: z.number().nullable(),
    due_date: z.string().nullable(),
    review_horizon: z.enum(["near", "far", "none"]),
  }) as unknown as z.ZodType<CreateFollowUpInput>,
  audit: {
    table: "homework_assignments",
    recordId: (i) => `${i.booking_id}:${i.student_id}`,
    action: "INSERT",
    reasonPrefix: "teacher create follow-up",
  },
  preflight: async () => ({ actorId: await requireUserId() }),
  handler: async (input) => {
    const rangeError = validateHomeworkRange(input.surah_number, input.ayah_start, input.ayah_end);
    if (rangeError) throw new UserError(rangeError);
    const actor = await teacherOrAboveActor();
    // admin: teacher/admin writes about a student's homework (cross-user) (issue #523)
    await createFollowUpDomain(createAdminClient(), actor, {
      bookingId: input.booking_id,
      studentId: input.student_id,
      sessionId: input.session_id,
      homeworkType: input.homework_type,
      title: input.title,
      description: input.description,
      surahNumber: input.surah_number,
      ayahStart: input.ayah_start,
      ayahEnd: input.ayah_end,
      pagesCount: input.pages_count,
      dueDate: input.due_date,
      reviewHorizon: input.review_horizon,
    });
    revalidateFollowUpPaths();
    return { message: "created" };
  },
});

export async function createFollowUp(formData: FormData) {
  const booking_id = formData.get("booking_id") as string;
  const student_id = formData.get("student_id") as string;
  const session_id = (formData.get("session_id") as string) || null;
  const homework_type = formData.get("homework_type") as string;
  const title = formData.get("title") as string;
  const description = (formData.get("description") as string) || null;
  const surah_number = formData.get("surah_number") ? Number(formData.get("surah_number")) : null;
  const ayah_start = formData.get("ayah_start") ? Number(formData.get("ayah_start")) : null;
  const ayah_end = formData.get("ayah_end") ? Number(formData.get("ayah_end")) : null;
  const pages_count = formData.get("pages_count") ? Number(formData.get("pages_count")) : null;
  const due_date = (formData.get("due_date") as string) || null;

  const horizonRaw = formData.get("review_horizon") as string | null;
  const review_horizon: ReviewHorizon =
    horizonRaw === "near" || horizonRaw === "far" || horizonRaw === "none"
      ? horizonRaw
      : "none";

  if (!booking_id || !student_id || !homework_type || !title) {
    return { error: "جميع الحقول المطلوبة يجب ملؤها" };
  }

  const result = await createFollowUpBase({
    booking_id,
    student_id,
    session_id,
    homework_type,
    title,
    description,
    surah_number,
    ayah_start,
    ayah_end,
    pages_count,
    due_date,
    review_horizon,
  });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── 2. Mark Student Ready ──────────────────────────────────────────────────

type MarkStudentReadyInput = {
  homeworkId: string;
  audio: { path: string; durationSeconds: number } | null;
};

const markStudentReadyBase = loudAction<MarkStudentReadyInput, { message: string }>({
  name: "homework.mark-student-ready",
  severity: "info",
  schema: z.object({
    homeworkId: z.string().uuid(),
    audio: z.object({ path: z.string(), durationSeconds: z.number() }).nullable(),
  }),
  audit: {
    table: "homework_assignments",
    recordId: (i) => i.homeworkId,
    action: "UPDATE",
    reasonPrefix: "student mark ready",
  },
  preflight: async () => ({ actorId: await requireUserId() }),
  handler: async ({ homeworkId, audio }) => {
    const actor = await studentActor();
    // Own-row write: domain re-checks hw.student_id === actor.id. RLS permits
    // the student to update their own homework_assignments row (issue #523 —
    // swapped from admin).
    await markStudentReadyDomain(await createClient(), actor, {
      followUpId: homeworkId,
      audio,
    });
    revalidateFollowUpPaths();
    return { message: "ready" };
  },
});

export async function markStudentReady(
  homeworkId: string,
  audio?: { path: string; durationSeconds: number },
) {
  const result = await markStudentReadyBase({ homeworkId, audio: audio ?? null });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── 3. Grade Follow-up ──────────────────────────────────────────────────────

type GradeFollowUpInput = {
  homeworkId: string;
  grade: HomeworkStatus;
  teacher_notes: string | null;
  errors?: CapturedError[];
};

const gradeFollowUpBase = loudAction<GradeFollowUpInput, { message: string }>({
  name: "homework.grade",
  severity: "warning",
  schema: gradeFollowUpSchema as unknown as z.ZodType<GradeFollowUpInput>,
  audit: {
    table: "homework_assignments",
    recordId: (i) => i.homeworkId,
    action: "UPDATE",
    reasonPrefix: "teacher grade follow-up",
  },
  preflight: async () => ({ actorId: await requireUserId() }),
  handler: async ({ homeworkId, grade, teacher_notes, errors }) => {
    const actor = await teacherOrAboveActor();
    // admin: teacher/admin writes about a student's homework (cross-user) (issue #523)
    await gradeFollowUpDomain(createAdminClient(), actor, {
      followUpId: homeworkId,
      grade,
      teacherNotes: teacher_notes,
      errors: errors ?? null,
    });
    revalidateFollowUpPaths();
    return { message: "graded" };
  },
});

export async function gradeFollowUp(homeworkId: string, formData: FormData) {
  const grade = formData.get("grade") as HomeworkStatus;
  const teacher_notes = (formData.get("teacher_notes") as string) || null;
  // Talqeen review (#541): tajweed errors arrive as a JSON blob. Parse loosely
  // here; the schema in gradeFollowUpBase re-validates each error shape.
  let errors: CapturedError[] | undefined;
  const rawErrors = formData.get("errors");
  if (typeof rawErrors === "string" && rawErrors) {
    try {
      const parsed = JSON.parse(rawErrors);
      if (Array.isArray(parsed)) errors = parsed as CapturedError[];
    } catch {
      return { error: "تعذّر قراءة الأخطاء" };
    }
  }
  const result = await gradeFollowUpBase({ homeworkId, grade, teacher_notes, errors });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── 4. Edit Follow-up ───────────────────────────────────────────────────────

type EditFollowUpInput = {
  homeworkId: string;
  updates: TableUpdate<"homework_assignments">;
};

const editFollowUpBase = loudAction<EditFollowUpInput, { message: string }>({
  name: "homework.edit",
  severity: "info",
  schema: z.object({
    homeworkId: z.string().uuid(),
    updates: editFollowUpUpdatesSchema,
  }) as unknown as z.ZodType<EditFollowUpInput>,
  audit: {
    table: "homework_assignments",
    recordId: (i) => i.homeworkId,
    action: "UPDATE",
    reasonPrefix: "teacher edit follow-up",
  },
  preflight: async () => ({ actorId: await requireUserId() }),
  handler: async ({ homeworkId, updates }) => {
    const actor = await teacherOrAboveActor();
    // admin: teacher/admin writes about a student's homework (cross-user) (issue #523)
    await editFollowUpDomain(createAdminClient(), actor, {
      followUpId: homeworkId,
      updates,
    });
    revalidateFollowUpPaths();
    return { message: "edited" };
  },
});

export async function editFollowUp(homeworkId: string, formData: FormData) {
  const updates: TableUpdate<"homework_assignments"> = {};
  const title = formData.get("title") as string;
  if (title !== null) updates.title = title || undefined;
  const description = formData.get("description") as string;
  if (description !== null) updates.description = description || null;
  const homework_type = formData.get("homework_type") as string;
  if (homework_type !== null) updates.homework_type = (homework_type || undefined) as TableUpdate<"homework_assignments">["homework_type"];
  const surah_number = formData.get("surah_number");
  if (surah_number !== null) updates.surah_number = surah_number ? Number(surah_number) : null;
  const ayah_start = formData.get("ayah_start");
  if (ayah_start !== null) updates.ayah_start = ayah_start ? Number(ayah_start) : null;
  const ayah_end = formData.get("ayah_end");
  if (ayah_end !== null) updates.ayah_end = ayah_end ? Number(ayah_end) : null;
  const pages_count = formData.get("pages_count");
  if (pages_count !== null) updates.pages_count = pages_count ? Number(pages_count) : null;
  const due_date = formData.get("due_date") as string;
  if (due_date !== null) updates.due_date = due_date || null;
  const teacher_notes = formData.get("teacher_notes") as string;
  if (teacher_notes !== null) updates.teacher_notes = teacher_notes || null;

  const result = await editFollowUpBase({ homeworkId, updates });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── 5. Get Follow-up Audio Signed URL ───────────────────────────────────────
// Read-only — not wrapped in loudAction (no DB write, no audit row warranted).
// Per ADR-0002 §1, reads stay at the route boundary.

export async function getFollowUpAudioUrl(
  followUpId: string,
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  const { data: hw, error: hwErr } = await supabase
    .from("homework_assignments")
    .select("audio_url, student_id, teacher_id")
    .eq("id", followUpId)
    .single<{ audio_url: string | null; student_id: string; teacher_id: string }>();

  if (hwErr && hwErr.code !== "PGRST116") {
    logError("failed to read follow-up for audio URL", hwErr, {
      tag: "follow-up", followUpId,
    });
    return { error: "تعذّر تحميل المتابعة" };
  }

  if (!hw) return { error: "المتابعة غير موجودة" };
  if (!hw.audio_url) return { error: "لا يوجد تسجيل صوتي" };

  const { data, error } = await supabase
    .storage
    .from("homework-audio")
    .createSignedUrl(hw.audio_url, 3600);

  if (error || !data) {
    logError("createSignedUrl failed for follow-up audio", error, {
      tag: "follow-up", followUpId,
    });
    return { error: "تعذّر تحميل التسجيل" };
  }

  return { url: data.signedUrl };
}

// ─── 6. Delete Follow-up ─────────────────────────────────────────────────────

const deleteFollowUpBase = loudAction<{ homeworkId: string }, { message: string }>({
  name: "homework.delete",
  severity: "warning",
  schema: z.object({ homeworkId: z.string().uuid() }),
  audit: {
    table: "homework_assignments",
    recordId: (i) => i.homeworkId,
    action: "DELETE",
    reasonPrefix: "teacher delete follow-up",
  },
  preflight: async () => ({ actorId: await requireUserId() }),
  handler: async ({ homeworkId }) => {
    const actor = await anyAuthedActor();
    // admin: teacher/admin writes about a student's homework (cross-user) (issue #523)
    await deleteFollowUpDomain(createAdminClient(), actor, { followUpId: homeworkId });
    revalidateFollowUpPaths();
    return { message: "deleted" };
  },
});

export async function deleteFollowUp(homeworkId: string) {
  const result = await deleteFollowUpBase({ homeworkId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}
