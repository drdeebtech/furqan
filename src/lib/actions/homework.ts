"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { notifyParentHomeworkNotDone } from "@/lib/notifications/parent";
import { notify } from "@/lib/notifications/dispatcher";
import { HOMEWORK_STATUS_AR, type ReviewHorizon } from "@/lib/constants";
import { logError } from "@/lib/logger";
import type { HomeworkStatus, HomeworkAssignment } from "@/types/database";
import { emitEvent } from "@/lib/automation/emit";
import { dispatchEffects } from "@/lib/automation/effects";
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

// ─── Auth helpers ───────────────────────────────────────────────────────────

async function requireTeacherOrAbove(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id)
    .single().then(r => ({ data: r.data as { role: string } | null }));
  if (!profile || !["admin", "teacher"].includes(profile.role)) {
    throw new UserError("غير مصرح");
  }
  return { user, role: profile.role };
}

async function requireStudent(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مسجل الدخول");
  return user;
}

async function teacherOrAbovePreflight(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const { user } = await requireTeacherOrAbove(supabase);
  return { actorId: user.id };
}

async function studentPreflight(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const user = await requireStudent(supabase);
  return { actorId: user.id };
}

function revalidateFollowUpPaths() {
  revalidatePath("/teacher/follow-up");
  revalidatePath("/teacher/talqeen");
  revalidatePath("/teacher/sessions");
  revalidatePath("/student/follow-up");
  revalidatePath("/student/dashboard");
  revalidatePath("/student/sessions");
}

// ─── 1. Create Follow-up ─────────────────────────────────────────────────────

type CreateHomeworkInput = {
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

const createHomeworkBase = loudAction<CreateHomeworkInput, { message: string }>({
  name: "homework.create",
  // P1 lifecycle entry. severity=info — routine assignment creation.
  severity: "info",
  // Schema is permissive; the public wrapper validates required fields and
  // surfaces the existing Arabic copy on failure.
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
  }) as unknown as z.ZodType<CreateHomeworkInput>,
  audit: {
    table: "homework_assignments",
    recordId: (i) => `${i.booking_id}:${i.student_id}`,
    action: "INSERT",
    reasonPrefix: "teacher create follow-up",
  },
  preflight: teacherOrAbovePreflight,
  handler: async (input, { actorId }) => {
    const supabase = await createClient();

    // Verify teacher owns the booking; admins bypass ownership.
    // Real infra errors (non-PGRST116) block even the admin bypass —
    // they indicate RLS regression or DB outage, not "row missing".
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings").select("teacher_id").eq("id", input.booking_id)
      .single<{ teacher_id: string }>();
    if (bookingErr && bookingErr.code !== "PGRST116") {
      throw new UserError("ليس لديك صلاحية على هذا الحجز", { cause: bookingErr });
    }
    if (!booking || booking.teacher_id !== actorId) {
      const { data: p, error: roleErr } = await supabase
        .from("profiles").select("role").eq("id", actorId as string)
        .single<{ role: string }>();
      if (roleErr && roleErr.code !== "PGRST116") {
        throw new UserError("ليس لديك صلاحية على هذا الحجز", { cause: roleErr });
      }
      if (!p || !["admin"].includes(p.role)) {
        throw new UserError("ليس لديك صلاحية على هذا الحجز");
      }
    }

    const { error } = await supabase.from("homework_assignments").insert({
      booking_id: input.booking_id,
      student_id: input.student_id,
      session_id: input.session_id,
      teacher_id: actorId,
      homework_type: input.homework_type,
      title: input.title,
      description: input.description,
      surah_number: input.surah_number,
      ayah_start: input.ayah_start,
      ayah_end: input.ayah_end,
      pages_count: input.pages_count,
      due_date: input.due_date,
      review_horizon: input.review_horizon,
    } as never);
    if (error) throw new UserError("فشل إنشاء المتابعة", { cause: error });

    // Best-effort student notification — must not fail the assignment. The
    // in-app fan-out is now declared in EVENT_EFFECTS["homework.assigned"]
    // (src/lib/automation/effects.ts); dispatchEffects never throws, so the
    // assignment is safe regardless of notification outcome.
    await dispatchEffects("homework.assigned", {
      studentId: input.student_id,
      entityId: input.booking_id,
      title: input.title,
    });

    revalidateFollowUpPaths();
    await emitEvent("homework.assigned", "homework", input.booking_id, {
      student_id: input.student_id,
      teacher_id: actorId,
      homework_type: input.homework_type,
      title: input.title,
    }).catch((err) => logError("emit homework.assigned failed", err, { tag: "automation", event: "homework.assigned" }));
    return { message: "created" };
  },
});

export async function createHomework(formData: FormData) {
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

  // Pedagogical intent at creation time. Defaults to 'none' so an older
  // form that doesn't post review_horizon still works. Validated against the
  // CHECK constraint values; anything else falls back to 'none' rather than
  // failing, since the field is teacher metadata not user-blocking.
  const horizonRaw = formData.get("review_horizon") as string | null;
  const review_horizon: ReviewHorizon =
    horizonRaw === "near" || horizonRaw === "far" || horizonRaw === "none"
      ? horizonRaw
      : "none";

  if (!booking_id || !student_id || !homework_type || !title) {
    return { error: "جميع الحقول المطلوبة يجب ملؤها" };
  }

  const result = await createHomeworkBase({
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

/**
 * Mark a follow-up assignment "ready" for the teacher to grade. Optionally
 * attaches an audio submission in one atomic update so the teacher sees both
 * the ready-state and the audio together (no half-submitted state). Audio
 * payload (path + duration) is validated separately via attachHomeworkAudio
 * before this is called so the upload + metadata write happen as one user
 * action from the UI's perspective.
 */
type MarkReadyInput = {
  homeworkId: string;
  audio: { path: string; durationSeconds: number } | null;
};

const markStudentReadyBase = loudAction<MarkReadyInput, { message: string }>({
  name: "homework.mark-student-ready",
  // P1 state transition. severity=info — routine.
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
  preflight: studentPreflight,
  handler: async ({ homeworkId, audio }, { actorId }) => {
    const supabase = await createClient();

    // Verify ownership and current status
    const { data: hw, error: hwErr } = await supabase
      .from("homework_assignments")
      .select("student_id, teacher_id, status, title")
      .eq("id", homeworkId)
      .returns<{ student_id: string; teacher_id: string; status: string; title: string }[]>()
      .single();

    if (hwErr || !hw) throw notFoundOrInfra(hwErr, "المتابعة غير موجودة");
    if (hw.student_id !== actorId) throw new UserError("غير مصرح");
    if (hw.status !== "assigned") throw new UserError("حالة المتابعة لا تسمح بهذا الإجراء");

    // Validate optional audio payload — defense in depth (RLS already gates
    // the upload itself, but we re-check here so a malformed call can't sneak
    // a wrong-student path or out-of-range duration into the metadata row).
    if (audio) {
      const expectedPrefix = `${actorId}/${homeworkId}/`;
      if (!audio.path.startsWith(expectedPrefix)) {
        throw new UserError("مسار الصوت غير صالح");
      }
      if (
        !Number.isFinite(audio.durationSeconds) ||
        audio.durationSeconds < 1 ||
        audio.durationSeconds > 300
      ) {
        throw new UserError("مدة الصوت غير صالحة");
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

    const { error } = await supabase
      .from("homework_assignments")
      .update(updatePayload)
      .eq("id", homeworkId);

    if (error) throw new UserError("فشل تحديث حالة المتابعة", { cause: error });

    // Best-effort teacher notification.
    try {
      const { data: student } = await supabase
        .from("profiles").select("full_name").eq("id", actorId as string)
        .single<{ full_name: string | null }>();
      const studentName = student?.full_name ?? "الطالب";

      await notify({
        userId: hw.teacher_id,
        type: "homework",
        title: "طالب جاهز",
        body: `${studentName} جاهز لتسميع المتابعة: ${hw.title}`,
        entityType: "homework",
        entityId: homeworkId,
      });
    } catch (err) {
      logError("notify teacher failed during markStudentReady", err, {
        component: "homework.markStudentReady",
        metadata: { teacher_id: hw.teacher_id, homeworkId },
      });
    }

    revalidateFollowUpPaths();
    await emitEvent("homework.student_ready", "homework", homeworkId, {
      student_id: actorId,
      teacher_id: hw.teacher_id,
    }).catch((err) => logError("emit homework.student_ready failed", err, { tag: "automation", event: "homework.student_ready" }));
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

type GradeHomeworkInput = {
  homeworkId: string;
  grade: HomeworkStatus;
  teacher_notes: string | null;
};

const gradeHomeworkBase = loudAction<GradeHomeworkInput, { message: string }>({
  name: "homework.grade",
  // P0 highest blast radius — auto-regenerates next assignment on
  // needs_work / not_done, fires student + parent notifications, fan-out
  // through n8n. severity=warning so a silent system failure here gets
  // Sentry capture without paging Telegram on every routine grade pass.
  severity: "warning",
  schema: z.object({
    homeworkId: z.string().uuid(),
    grade: z.string() as unknown as z.ZodType<HomeworkStatus>,
    teacher_notes: z.string().nullable(),
  }),
  audit: {
    table: "homework_assignments",
    recordId: (i) => i.homeworkId,
    action: "UPDATE",
    reasonPrefix: "teacher grade follow-up",
  },
  preflight: teacherOrAbovePreflight,
  handler: async ({ homeworkId, grade, teacher_notes }, { actorId }) => {
    const supabase = await createClient();

    const validGrades: HomeworkStatus[] = [
      "completed_excellent", "completed_good", "completed_needs_work", "completed_not_done",
    ];
    if (!grade || !validGrades.includes(grade)) {
      throw new UserError("يرجى اختيار تقييم صحيح");
    }

    // Fetch current follow-up
    const { data: hw, error: hwErr } = await supabase
      .from("homework_assignments")
      .select("*")
      .eq("id", homeworkId)
      .returns<HomeworkAssignment[]>()
      .single();

    if (hwErr || !hw) throw notFoundOrInfra(hwErr, "المتابعة غير موجودة");
    if (hw.teacher_id !== actorId) {
      const { data: p, error: roleErr } = await supabase
        .from("profiles").select("role").eq("id", actorId as string)
        .single<{ role: string }>();
      if (roleErr && roleErr.code !== "PGRST116") {
        throw new UserError("غير مصرح", { cause: roleErr });
      }
      if (!p || !["admin"].includes(p.role)) {
        throw new UserError("غير مصرح");
      }
    }
    if (hw.status !== "student_ready") {
      throw new UserError("الطالب لم يؤكد جاهزيته بعد");
    }

    // Update grade
    const { error } = await supabase
      .from("homework_assignments")
      .update({
        status: grade,
        completed_at: new Date().toISOString(),
        teacher_notes,
      } as never)
      .eq("id", homeworkId);

    if (error) throw new UserError("فشل تقييم المتابعة", { cause: error });

    const gradeLabel = HOMEWORK_STATUS_AR[grade];

    // Best-effort student notification.
    try {
      await notify({
        userId: hw.student_id,
        type: "homework",
        title: "تم تقييم متابعتك",
        body: `تم تقييم متابعة "${hw.title}" — النتيجة: ${gradeLabel}`,
        entityType: "homework",
        entityId: homeworkId,
      });
    } catch (err) {
      logError("notify student failed during gradeHomework", err, {
        component: "homework.gradeHomework",
        metadata: { student_id: hw.student_id, homeworkId, grade },
      });
    }

    // Auto-regeneration for needs_work / not_done. The whole branch is
    // best-effort — a regen failure must not fail the grade DB write that
    // already succeeded. Each side-effect inside (insert, notify, parent
    // report) catches its own errors via logError.
    if (grade === "completed_needs_work" || grade === "completed_not_done") {
      try {
        // Create new assignment linked to the original. The child inherits
        // parent.review_horizon so a "near" follow-up that gets re-assigned
        // stays in the student's "From last session" bucket — losing the
        // horizon would silently demote it to "New work".
        const { error: regenErr } = await supabase.from("homework_assignments").insert({
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
          // review_horizon shipped in 20260505131935; supabase.generated.ts is
          // stale because CLI is auth'd to the wrong account (see CLAUDE.md
          // "Supabase MCP — wrong-account gotcha"). Cast until next legitimate
          // db:types regen.
          review_horizon: (hw as unknown as { review_horizon: string | null }).review_horizon,
          parent_assignment_id: homeworkId,
        } as never);
        if (regenErr) logError("homework auto-regen failed", regenErr, {
          tag: "homework", severity: "warning",
          metadata: { homeworkId, studentId: hw.student_id, grade },
        });

        // Notify student about re-assignment
        await notify({
          userId: hw.student_id,
          type: "homework",
          title: "تم إعادة تكليفك بالمتابعة",
          body: `تمت إعادة تكليفك بمتابعة "${hw.title}" — يرجى المحاولة مجدداً`,
          entityType: "homework",
          entityId: homeworkId,
        });

        // Notify parent
        await notifyParentHomeworkNotDone(
          hw.student_id,
          hw.teacher_id,
          hw.title,
          grade,
          actorId as string,
        );
      } catch (err) {
        logError("auto-regen branch failed during gradeHomework", err, {
          component: "homework.gradeHomework.regen",
          metadata: { student_id: hw.student_id, homeworkId, grade },
        });
      }
    }

    revalidateFollowUpPaths();
    await emitEvent("homework.graded", "homework", homeworkId, {
      student_id: hw.student_id,
      teacher_id: hw.teacher_id,
      grade,
    }).catch((err) => logError("emit homework.graded failed", err, { tag: "automation", event: "homework.graded" }));
    return { message: "graded" };
  },
});

export async function gradeHomework(homeworkId: string, formData: FormData) {
  const grade = formData.get("grade") as HomeworkStatus;
  const teacher_notes = (formData.get("teacher_notes") as string) || null;
  const result = await gradeHomeworkBase({ homeworkId, grade, teacher_notes });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── 4. Edit Follow-up ───────────────────────────────────────────────────────

type EditHomeworkInput = {
  homeworkId: string;
  updates: TableUpdate<"homework_assignments">;
};

const editHomeworkBase = loudAction<EditHomeworkInput, { message: string }>({
  name: "homework.edit",
  // P1 routine update. severity=info.
  severity: "info",
  schema: z.object({
    homeworkId: z.string().uuid(),
    updates: z.record(z.string(), z.unknown()),
  }) as unknown as z.ZodType<EditHomeworkInput>,
  audit: {
    table: "homework_assignments",
    recordId: (i) => i.homeworkId,
    action: "UPDATE",
    reasonPrefix: "teacher edit follow-up",
  },
  preflight: teacherOrAbovePreflight,
  handler: async ({ homeworkId, updates }, { actorId }) => {
    const supabase = await createClient();

    // Fetch follow-up — pull status so we can guard against editing graded rows.
    const { data: hw, error: hwErr } = await supabase
      .from("homework_assignments")
      .select("teacher_id, student_id, assigned_at, status")
      .eq("id", homeworkId)
      .returns<{ teacher_id: string; student_id: string; assigned_at: string; status: HomeworkStatus }[]>()
      .single();

    if (hwErr || !hw) throw notFoundOrInfra(hwErr, "المتابعة غير موجودة");
    if (hw.teacher_id !== actorId) {
      const { data: p, error: roleErr } = await supabase
        .from("profiles").select("role").eq("id", actorId as string)
        .single<{ role: string }>();
      if (roleErr && roleErr.code !== "PGRST116") {
        throw new UserError("غير مصرح", { cause: roleErr });
      }
      if (!p || !["admin"].includes(p.role)) {
        throw new UserError("غير مصرح");
      }
    }

    // Status guard: graded follow-ups are immutable. Editing the title/description
    // post-grade would silently change what the student is being graded against,
    // with no re-validation and no notification. To re-grade, use the explicit
    // gradeHomework flow (which fires student notifications + parent reports).
    const GRADED_STATUSES: HomeworkStatus[] = [
      "completed_excellent", "completed_good", "completed_needs_work", "completed_not_done",
    ];
    if (GRADED_STATUSES.includes(hw.status)) {
      throw new UserError("لا يمكن تعديل متابعة تم تقييمها. للتغيير، أنشئ متابعة جديدة.");
    }

    // Check edit window: find next session between same teacher+student.
    // PGRST116 (no row) is the common case (no future booking yet) — falls
    // through to the no-window-needed branch. Real infra errors throw.
    const { data: nextBooking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id")
      .eq("teacher_id", hw.teacher_id)
      .eq("student_id", hw.student_id)
      .eq("status", "confirmed")
      .gt("scheduled_at", hw.assigned_at)
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .single<{ id: string }>();

    if (bookingErr && bookingErr.code !== "PGRST116") {
      throw new UserError("فشل تعديل المتابعة", { cause: bookingErr });
    }

    if (nextBooking) {
      const { data: nextSession, error: sessionErr } = await supabase
        .from("sessions")
        .select("started_at")
        .eq("booking_id", nextBooking.id)
        .single<{ started_at: string | null }>();

      if (sessionErr && sessionErr.code !== "PGRST116") {
        throw new UserError("فشل تعديل المتابعة", { cause: sessionErr });
      }

      if (nextSession?.started_at) {
        throw new UserError("انتهت فترة التعديل — بدأت الجلسة التالية");
      }
    }

    const finalUpdates: TableUpdate<"homework_assignments"> = {
      ...updates,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("homework_assignments")
      .update(finalUpdates)
      .eq("id", homeworkId);

    if (error) throw new UserError("فشل تعديل المتابعة", { cause: error });

    revalidateFollowUpPaths();
    return { message: "edited" };
  },
});

export async function editHomework(homeworkId: string, formData: FormData) {
  // Build update object — same shape as pre-wrap, just hoisted to the wrapper.
  const updates: TableUpdate<"homework_assignments"> = {};
  const title = formData.get("title") as string;
  if (title) updates.title = title;
  const description = formData.get("description") as string;
  if (description !== null) updates.description = description || null;
  const homework_type = formData.get("homework_type") as string;
  if (homework_type) updates.homework_type = homework_type as TableUpdate<"homework_assignments">["homework_type"];
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

  const result = await editHomeworkBase({ homeworkId, updates });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── 5. Get Follow-up Audio Signed URL ───────────────────────────────────────
// The homework-audio bucket is private; playback requires a short-lived
// signed URL. Storage RLS gates which paths the caller can sign — student
// can sign their own, teacher can sign for any homework_assignments row
// they own, admin/mod can sign all. The action just bridges from the
// authenticated server-side client to the browser's <audio> element.
//
// NOT wrapped in loudAction — read-only, returns a URL payload that doesn't
// fit Output: { message?: string }, no audit row warranted (signed URL
// generation is not a state change).

export async function getHomeworkAudioUrl(
  homeworkId: string,
): Promise<{ url: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  const { data: hw } = await supabase
    .from("homework_assignments")
    .select("audio_url, student_id, teacher_id")
    .eq("id", homeworkId)
    .single<{ audio_url: string | null; student_id: string; teacher_id: string }>();

  if (!hw) return { error: "المتابعة غير موجودة" };
  if (!hw.audio_url) return { error: "لا يوجد تسجيل صوتي" };

  // Sign for 1 hour. The HTML5 <audio> element will cache the URL for the
  // lifetime of the page; if the page sits open longer than that, the user
  // refreshes to get a new URL.
  const { data, error } = await supabase
    .storage
    .from("homework-audio")
    .createSignedUrl(hw.audio_url, 3600);

  if (error || !data) {
    logError("createSignedUrl failed for homework audio", error, {
      tag: "homework", homeworkId,
    });
    return { error: "تعذّر تحميل التسجيل" };
  }

  return { url: data.signedUrl };
}

// ─── 6. Delete Follow-up ─────────────────────────────────────────────────────

const deleteHomeworkBase = loudAction<{ homeworkId: string }, { message: string }>({
  name: "homework.delete",
  // P0 destructive — cascades to child assignments. severity=warning so
  // Sentry captures without Telegram-paging on routine teacher cleanup.
  severity: "warning",
  schema: z.object({ homeworkId: z.string().uuid() }),
  audit: {
    table: "homework_assignments",
    recordId: (i) => i.homeworkId,
    action: "DELETE",
    reasonPrefix: "teacher delete follow-up",
  },
  // Custom preflight: any authenticated user passes; the handler does the
  // teacher-owns-or-admin check inline (matches pre-wrap behavior — a
  // student hitting this endpoint gets an "ليس لديك صلاحية" message after
  // the role lookup, not a generic auth denial).
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("غير مصرح");
    return { actorId: user.id };
  },
  handler: async ({ homeworkId }, { actorId }) => {
    const supabase = await createClient();

    const { data: hw, error: hwErr } = await supabase
      .from("homework_assignments")
      .select("teacher_id")
      .eq("id", homeworkId)
      .returns<{ teacher_id: string }[]>()
      .single();

    if (hwErr || !hw) throw notFoundOrInfra(hwErr, "المتابعة غير موجودة");

    // Verify ownership or admin
    if (hw.teacher_id !== actorId) {
      const { data: profile, error: roleErr } = await supabase
        .from("profiles").select("role").eq("id", actorId as string)
        .single<{ role: string }>();
      if (roleErr && roleErr.code !== "PGRST116") {
        throw new UserError("ليس لديك صلاحية", { cause: roleErr });
      }
      if (!profile || !["admin"].includes(profile.role)) {
        throw new UserError("ليس لديك صلاحية");
      }
    }

    // Count + delete children (auto-regenerated assignments) first.
    // Without this audit trail, a teacher deleting a parent follow-up would
    // silently delete N regenerated child assignments — the student would
    // see them disappear from /student/follow-up with no explanation.
    // We log how many we cascaded so admins can trace "where did those go".
    const { data: children, error: childrenErr } = await supabase
      .from("homework_assignments")
      .select("id, status, title")
      .eq("parent_assignment_id", homeworkId)
      .returns<{ id: string; status: string; title: string }[]>();
    if (childrenErr) {
      // Real infra error during the cascade-count read. Block the delete
      // rather than risk an unbounded cascade with no audit.
      throw new UserError("فشل حذف المتابعة", { cause: childrenErr });
    }
    const childCount = children?.length ?? 0;

    if (childCount > 0) {
      await supabase
        .from("homework_assignments")
        .delete()
        .eq("parent_assignment_id", homeworkId);
    }

    // Delete the follow-up
    const { error } = await supabase
      .from("homework_assignments")
      .delete()
      .eq("id", homeworkId);

    if (error) throw new UserError("فشل حذف المتابعة", { cause: error });

    // Diff audit row carries cascade size — distinct from loudAction's
    // input-only envelope. Best-effort: an audit_log insert failure must
    // never block the delete itself succeeding.
    await supabase
      .from("audit_log")
      .insert({
        changed_by: actorId,
        action: "DELETE",
        table_name: "homework_assignments",
        record_id: homeworkId,
        new_data: { cascaded_children: childCount, child_ids: children?.map((c) => c.id) ?? [] },
      } satisfies TableInsert<"audit_log">)
      .then((r) => {
        if (r.error) logError("audit_log insert failed for homework delete", r.error, {
          tag: "audit", homeworkId, childCount,
        });
      });

    revalidateFollowUpPaths();
    return { message: "deleted" };
  },
});

export async function deleteHomework(homeworkId: string) {
  const result = await deleteHomeworkBase({ homeworkId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}
