import "server-only";

import { notify } from "@/lib/notifications/dispatcher";
import { notifyParentHomeworkNotDone } from "@/lib/notifications/parent";
import { emitEvent } from "@/lib/automation/emit";
import { HOMEWORK_STATUS_AR } from "@/lib/constants";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import type { HomeworkStatus, HomeworkAssignment } from "@/types/database";
import { assertCanManage, type AdminClient } from "./shared";
import {
  FollowUpUserError,
  FollowUpNotFoundError,
  type FollowUpActor,
  type CreateFollowUpInput,
  type CreateFollowUpResult,
  type MarkStudentReadyInput,
  type MarkStudentReadyResult,
  type GradeFollowUpInput,
  type GradeFollowUpResult,
} from "./types";

/**
 * Follow-up domain — lifecycle write surface (ADR-0002 shape, Booking-pilot
 * mirror): create → mark-ready → grade. The manage writes (edit / delete)
 * live in `./manage` to keep each file under the 500-line ceiling.
 *
 * These functions own the follow-up (`homework_assignments`) write logic:
 * the row-level authorization (teacher-owns-the-booking/row OR admin),
 * the state-transition guards, the DB write, the best-effort student /
 * teacher / parent notifications, the audit rows, and the canonical
 * `homework.*` events.
 *
 * Intentionally NOT the domain's job (lives at the route adapter per
 * ADR-0002 §1):
 *   - Authentication (`auth.getUser`) and FormData parsing
 *   - `loudAction` wrapping (audit envelope, Sentry breadcrumb, Telegram)
 *   - `revalidatePath(...)` of the follow-up surfaces
 *
 * Each function takes the admin Supabase client (mirrors the Progress
 * domain's `recordProgress(admin, input)` signature) plus a resolved
 * `FollowUpActor` ({ id, isAdmin }). The admin client is used because the
 * follow-up RLS policies are teacher-scoped; the domain re-enforces
 * ownership explicitly via the passed-in actor so a service-role client
 * never silently bypasses the authorization the legacy code performed.
 *
 * Failure shape (ADR-0002 §4): throw on every error path.
 *   - `FollowUpUserError(message, { cause? })` — authorization/validation/
 *     state-guard failure, or a wrapped DB error. Carries the `userError`
 *     duck-type so the `loudAction` boundary surfaces the Arabic message.
 *   - `FollowUpNotFoundError(message, { cause? })` — row missing or infra
 *     read failure (mirrors `notFoundOrInfra`).
 */

// ─── 1. Create Follow-up ─────────────────────────────────────────────────────

/**
 * Creates a follow-up assignment, notifies the student (best-effort), and
 * emits `homework.assigned`. Verifies the actor owns the booking (admins
 * bypass ownership). Real infra errors during the ownership read block
 * even the admin bypass — they indicate RLS regression or DB outage, not
 * "row missing".
 */
export async function createFollowUp(
  admin: AdminClient,
  actor: FollowUpActor,
  input: CreateFollowUpInput,
): Promise<CreateFollowUpResult> {
  // Verify teacher owns the booking; admins bypass ownership.
  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("teacher_id")
    .eq("id", input.bookingId)
    .single<{ teacher_id: string }>();
  if (bookingErr && bookingErr.code !== "PGRST116") {
    throw new FollowUpUserError("ليس لديك صلاحية على هذا الحجز", { cause: bookingErr });
  }
  if (!booking || booking.teacher_id !== actor.id) {
    if (!actor.isAdmin) {
      throw new FollowUpUserError("ليس لديك صلاحية على هذا الحجز");
    }
  }

  const insertPayload: TableInsert<"homework_assignments"> = {
    booking_id: input.bookingId,
    student_id: input.studentId,
    session_id: input.sessionId,
    teacher_id: actor.id,
    // homework_type is a free-form string at the route boundary (legacy
    // form posts an arbitrary value); cast to the column union, matching
    // the legacy insert's `as never` tolerance.
    homework_type: input.homeworkType as TableInsert<"homework_assignments">["homework_type"],
    title: input.title,
    description: input.description,
    surah_number: input.surahNumber,
    ayah_start: input.ayahStart,
    ayah_end: input.ayahEnd,
    pages_count: input.pagesCount,
    due_date: input.dueDate,
    review_horizon: input.reviewHorizon,
  };
  const { error } = await admin.from("homework_assignments").insert(insertPayload);
  if (error) throw new FollowUpUserError("فشل إنشاء المتابعة", { cause: error });

  // Best-effort student notification — must not fail the assignment.
  try {
    await notify({
      userId: input.studentId,
      type: "homework",
      title: "متابعة جديدة",
      body: `كلّفك معلمك بمتابعة جديدة — ${input.title}`,
      entityType: "homework",
      entityId: input.bookingId,
    });
  } catch (err) {
    logError("notify student failed during createFollowUp", err, {
      component: "follow-up.createFollowUp",
      metadata: { student_id: input.studentId, booking_id: input.bookingId },
    });
  }

  await emitEvent("homework.assigned", "homework", input.bookingId, {
    student_id: input.studentId,
    teacher_id: actor.id,
    homework_type: input.homeworkType,
    title: input.title,
  }).catch((err) =>
    logError("emit homework.assigned failed", err, { tag: "automation", event: "homework.assigned" }),
  );

  return { studentId: input.studentId, bookingId: input.bookingId };
}

// ─── 2. Mark Student Ready ──────────────────────────────────────────────────

/**
 * Marks a follow-up "ready" for the teacher to grade. Optionally attaches
 * an audio submission in one atomic update so the teacher sees ready-state
 * and audio together (no half-submitted state). Verifies the actor is the
 * owning student and the row is `assigned`. Notifies the teacher
 * (best-effort) and emits `homework.student_ready`.
 *
 * Unlike the teacher/admin writes, this is student-scoped: the actor MUST
 * be the follow-up's student (no admin bypass — matches legacy behavior).
 */
export async function markStudentReady(
  admin: AdminClient,
  actor: FollowUpActor,
  input: MarkStudentReadyInput,
): Promise<MarkStudentReadyResult> {
  const { followUpId, audio } = input;

  const { data: hw, error: hwErr } = await admin
    .from("homework_assignments")
    .select("student_id, teacher_id, status, title")
    .eq("id", followUpId)
    .returns<{ student_id: string; teacher_id: string; status: string; title: string }[]>()
    .single();

  if (hwErr || !hw) {
    throw new FollowUpNotFoundError("المتابعة غير موجودة", { cause: hwErr ?? undefined });
  }
  if (hw.student_id !== actor.id) throw new FollowUpUserError("غير مصرح");
  if (hw.status !== "assigned") {
    throw new FollowUpUserError("حالة المتابعة لا تسمح بهذا الإجراء");
  }

  // Validate optional audio payload — defense in depth (RLS gates the
  // upload itself, but we re-check so a malformed call can't sneak a
  // wrong-student path or out-of-range duration into the metadata row).
  if (audio) {
    const expectedPrefix = `${actor.id}/${followUpId}/`;
    if (!audio.path.startsWith(expectedPrefix)) {
      throw new FollowUpUserError("مسار الصوت غير صالح");
    }
    if (
      !Number.isFinite(audio.durationSeconds) ||
      audio.durationSeconds < 1 ||
      audio.durationSeconds > 300
    ) {
      throw new FollowUpUserError("مدة الصوت غير صالحة");
    }
  }

  const updatePayload: TableUpdate<"homework_assignments"> = {
    status: "student_ready",
    ready_at: new Date().toISOString(),
  };
  if (audio) {
    updatePayload.audio_url = audio.path;
    updatePayload.audio_duration_seconds = audio.durationSeconds;
  }

  const { error } = await admin
    .from("homework_assignments")
    .update(updatePayload)
    .eq("id", followUpId);

  if (error) throw new FollowUpUserError("فشل تحديث حالة المتابعة", { cause: error });

  // Best-effort teacher notification.
  try {
    const { data: student } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", actor.id)
      .single<{ full_name: string | null }>();
    const studentName = student?.full_name ?? "الطالب";

    await notify({
      userId: hw.teacher_id,
      type: "homework",
      title: "طالب جاهز",
      body: `${studentName} جاهز لتسميع المتابعة: ${hw.title}`,
      entityType: "homework",
      entityId: followUpId,
    });
  } catch (err) {
    logError("notify teacher failed during markStudentReady", err, {
      component: "follow-up.markStudentReady",
      metadata: { teacher_id: hw.teacher_id, followUpId },
    });
  }

  await emitEvent("homework.student_ready", "homework", followUpId, {
    student_id: actor.id,
    teacher_id: hw.teacher_id,
  }).catch((err) =>
    logError("emit homework.student_ready failed", err, { tag: "automation", event: "homework.student_ready" }),
  );

  return { followUpId, studentId: actor.id, teacherId: hw.teacher_id };
}

// ─── 3. Grade Follow-up ──────────────────────────────────────────────────────

const VALID_GRADES: HomeworkStatus[] = [
  "completed_excellent",
  "completed_good",
  "completed_needs_work",
  "completed_not_done",
];

/**
 * Grades a `student_ready` follow-up. Verifies the actor owns the row
 * (admin bypass), guards the state, writes the grade, notifies the
 * student (best-effort), runs the needs_work/not_done auto-regeneration
 * branch (best-effort), and emits `homework.graded`.
 */
export async function gradeFollowUp(
  admin: AdminClient,
  actor: FollowUpActor,
  input: GradeFollowUpInput,
): Promise<GradeFollowUpResult> {
  const { followUpId, grade, teacherNotes } = input;

  if (!grade || !VALID_GRADES.includes(grade)) {
    throw new FollowUpUserError("يرجى اختيار تقييم صحيح");
  }

  const { data: hw, error: hwErr } = await admin
    .from("homework_assignments")
    .select("*")
    .eq("id", followUpId)
    .returns<HomeworkAssignment[]>()
    .single();

  if (hwErr || !hw) {
    throw new FollowUpNotFoundError("المتابعة غير موجودة", { cause: hwErr ?? undefined });
  }
  assertCanManage(actor, hw.teacher_id, "غير مصرح");
  if (hw.status !== "student_ready") {
    throw new FollowUpUserError("الطالب لم يؤكد جاهزيته بعد");
  }

  const { error } = await admin
    .from("homework_assignments")
    .update({
      status: grade,
      completed_at: new Date().toISOString(),
      teacher_notes: teacherNotes,
    } as never)
    .eq("id", followUpId);

  if (error) throw new FollowUpUserError("فشل تقييم المتابعة", { cause: error });

  const gradeLabel = HOMEWORK_STATUS_AR[grade];

  // Best-effort student notification.
  try {
    await notify({
      userId: hw.student_id,
      type: "homework",
      title: "تم تقييم متابعتك",
      body: `تم تقييم متابعة "${hw.title}" — النتيجة: ${gradeLabel}`,
      entityType: "homework",
      entityId: followUpId,
    });
  } catch (err) {
    logError("notify student failed during gradeFollowUp", err, {
      component: "follow-up.gradeFollowUp",
      metadata: { student_id: hw.student_id, followUpId, grade },
    });
  }

  // Auto-regeneration for needs_work / not_done. The whole branch is
  // best-effort — a regen failure must not fail the grade DB write that
  // already succeeded.
  if (grade === "completed_needs_work" || grade === "completed_not_done") {
    try {
      // Child inherits parent.review_horizon so a re-assigned "near"
      // follow-up stays in the student's "From last session" bucket.
      const { error: regenErr } = await admin.from("homework_assignments").insert({
        booking_id: hw.booking_id,
        student_id: hw.student_id,
        teacher_id: hw.teacher_id,
        homework_type: hw.homework_type,
        title: hw.title,
        description: hw.description,
        surah_number: hw.surah_number,
        ayah_start: hw.ayah_start,
        ayah_end: hw.ayah_end,
        pages_count: hw.pages_count,
        review_horizon: (hw as unknown as { review_horizon: string | null }).review_horizon,
        parent_assignment_id: followUpId,
      } as never);
      if (regenErr)
        logError("homework auto-regen failed", regenErr, {
          tag: "homework",
          severity: "warning",
          metadata: { followUpId, studentId: hw.student_id, grade },
        });

      // Notify student about re-assignment.
      await notify({
        userId: hw.student_id,
        type: "homework",
        title: "تم إعادة تكليفك بالمتابعة",
        body: `تمت إعادة تكليفك بمتابعة "${hw.title}" — يرجى المحاولة مجدداً`,
        entityType: "homework",
        entityId: followUpId,
      });

      // Notify parent.
      await notifyParentHomeworkNotDone(
        hw.student_id,
        hw.teacher_id,
        hw.title,
        grade,
        actor.id,
      );
    } catch (err) {
      logError("auto-regen branch failed during gradeFollowUp", err, {
        component: "follow-up.gradeFollowUp.regen",
        metadata: { student_id: hw.student_id, followUpId, grade },
      });
    }
  }

  await emitEvent("homework.graded", "homework", followUpId, {
    student_id: hw.student_id,
    teacher_id: hw.teacher_id,
    grade,
  }).catch((err) =>
    logError("emit homework.graded failed", err, { tag: "automation", event: "homework.graded" }),
  );

  return { followUpId, studentId: hw.student_id, teacherId: hw.teacher_id, grade };
}
