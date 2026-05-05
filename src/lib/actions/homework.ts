"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { notifyParentHomeworkNotDone } from "@/lib/notifications/parent";
import { notify } from "@/lib/notifications/dispatcher";
import { HOMEWORK_STATUS_AR, type ReviewHorizon } from "@/lib/constants";
import { logError } from "@/lib/logger";
import type { HomeworkStatus, HomeworkAssignment } from "@/types/database";
import { emitEvent } from "@/lib/automation/emit";

// ─── Auth helpers ───────────────────────────────────────────────────────────

async function requireTeacherOrAbove(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مسجل الدخول");
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id)
    .single().then(r => ({ data: r.data as { role: string } | null }));
  if (!profile || !["admin", "moderator", "teacher"].includes(profile.role)) {
    throw new Error("غير مصرح");
  }
  return { user, role: profile.role };
}

async function requireStudent(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مسجل الدخول");
  return user;
}

function revalidateFollowUpPaths() {
  revalidatePath("/teacher/follow-up");
  revalidatePath("/teacher/sessions");
  revalidatePath("/student/follow-up");
  revalidatePath("/student/dashboard");
  revalidatePath("/student/sessions");
}

// ─── 1. Create Homework ─────────────────────────────────────────────────────

export async function createHomework(formData: FormData) {
  const supabase = await createClient();
  const { user } = await requireTeacherOrAbove(supabase);

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

  // Verify teacher owns the booking
  const { data: booking } = await supabase
    .from("bookings").select("teacher_id").eq("id", booking_id)
    .single<{ teacher_id: string }>();
  if (!booking || booking.teacher_id !== user.id) {
    // Allow admin/mod to bypass ownership check
    const { data: p } = await supabase
      .from("profiles").select("role").eq("id", user.id)
      .single<{ role: string }>();
    if (!p || !["admin", "moderator"].includes(p.role)) {
      return { error: "ليس لديك صلاحية على هذا الحجز" };
    }
  }

  const { error } = await supabase.from("homework_assignments").insert({
    booking_id,
    student_id,
    session_id,
    teacher_id: user.id,
    homework_type,
    title,
    description,
    surah_number,
    ayah_start,
    ayah_end,
    pages_count,
    due_date,
    review_horizon,
  } as never);

  if (error) return { error: "فشل إنشاء المتابعة" };

  // Notify student
  try {
    await notify(student_id, "homework", "متابعة جديدة", `كلّفك معلمك بمتابعة جديدة — ${title}`, "homework", booking_id);
  } catch (err) {
    logError("notify student failed during createHomework", err, {
      component: "homework.createHomework",
      metadata: { student_id, booking_id },
    });
  }

  revalidateFollowUpPaths();
  await emitEvent("homework.assigned", "homework", booking_id, { student_id, teacher_id: user.id, homework_type, title })
    .catch((err) => logError("emit homework.assigned failed", err, { tag: "automation", event: "homework.assigned" }));
  return { success: true };
}

// ─── 2. Mark Student Ready ──────────────────────────────────────────────────

/**
 * Mark a homework assignment "ready" for the teacher to grade. Optionally
 * attaches an audio submission in one atomic update so the teacher sees both
 * the ready-state and the audio together (no half-submitted state). Audio
 * payload (path + duration) is validated separately via attachHomeworkAudio
 * before this is called so the upload + metadata write happen as one user
 * action from the UI's perspective.
 */
export async function markStudentReady(
  homeworkId: string,
  audio?: { path: string; durationSeconds: number },
) {
  const supabase = await createClient();
  const user = await requireStudent(supabase);

  // Verify ownership and current status
  const { data: hw } = await supabase
    .from("homework_assignments")
    .select("student_id, teacher_id, status, title")
    .eq("id", homeworkId)
    .returns<{ student_id: string; teacher_id: string; status: string; title: string }[]>()
    .single();

  if (!hw) return { error: "المتابعة غير موجودة" };
  if (hw.student_id !== user.id) return { error: "غير مصرح" };
  if (hw.status !== "assigned") return { error: "حالة المتابعة لا تسمح بهذا الإجراء" };

  // Validate optional audio payload — defense in depth (RLS already gates
  // the upload itself, but we re-check here so a malformed call can't sneak
  // a wrong-student path or out-of-range duration into the metadata row).
  if (audio) {
    const expectedPrefix = `${user.id}/${homeworkId}/`;
    if (!audio.path.startsWith(expectedPrefix)) {
      return { error: "مسار الصوت غير صالح" };
    }
    if (
      !Number.isFinite(audio.durationSeconds) ||
      audio.durationSeconds < 1 ||
      audio.durationSeconds > 300
    ) {
      return { error: "مدة الصوت غير صالحة" };
    }
  }

  const updatePayload: Record<string, unknown> = {
    status: "student_ready",
    ready_at: new Date().toISOString(),
  };
  if (audio) {
    updatePayload.audio_url = audio.path;
    updatePayload.audio_duration_seconds = audio.durationSeconds;
  }

  const { error } = await supabase
    .from("homework_assignments")
    .update(updatePayload as never)
    .eq("id", homeworkId);

  if (error) return { error: "فشل تحديث حالة المتابعة" };

  // Notify teacher
  try {
    const { data: student } = await supabase
      .from("profiles").select("full_name").eq("id", user.id)
      .single<{ full_name: string | null }>();
    const studentName = student?.full_name ?? "الطالب";

    await notify(hw.teacher_id, "homework", "طالب جاهز", `${studentName} جاهز لتسميع المتابعة: ${hw.title}`, "homework", homeworkId);
  } catch (err) {
    logError("notify teacher failed during markStudentReady", err, {
      component: "homework.markStudentReady",
      metadata: { teacher_id: hw.teacher_id, homeworkId },
    });
  }

  revalidateFollowUpPaths();
  await emitEvent("homework.student_ready", "homework", homeworkId, { student_id: user.id, teacher_id: hw.teacher_id })
    .catch((err) => logError("emit homework.student_ready failed", err, { tag: "automation", event: "homework.student_ready" }));
  return { success: true };
}

// ─── 3. Grade Homework ──────────────────────────────────────────────────────

export async function gradeHomework(homeworkId: string, formData: FormData) {
  const supabase = await createClient();
  const { user } = await requireTeacherOrAbove(supabase);

  const grade = formData.get("grade") as HomeworkStatus;
  const teacher_notes = (formData.get("teacher_notes") as string) || null;

  const validGrades: HomeworkStatus[] = [
    "completed_excellent", "completed_good", "completed_needs_work", "completed_not_done",
  ];
  if (!grade || !validGrades.includes(grade)) {
    return { error: "يرجى اختيار تقييم صحيح" };
  }

  // Fetch current homework
  const { data: hw } = await supabase
    .from("homework_assignments")
    .select("*")
    .eq("id", homeworkId)
    .returns<HomeworkAssignment[]>()
    .single();

  if (!hw) return { error: "المتابعة غير موجودة" };
  if (hw.teacher_id !== user.id) {
    const { data: p } = await supabase
      .from("profiles").select("role").eq("id", user.id)
      .single<{ role: string }>();
    if (!p || !["admin", "moderator"].includes(p.role)) {
      return { error: "غير مصرح" };
    }
  }
  if (hw.status !== "student_ready") {
    return { error: "الطالب لم يؤكد جاهزيته بعد" };
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

  if (error) return { error: "فشل تقييم المتابعة" };

  const gradeLabel = HOMEWORK_STATUS_AR[grade];

  // Notify student
  try {
    await notify(hw.student_id, "homework", "تم تقييم متابعتك", `تم تقييم متابعة "${hw.title}" — النتيجة: ${gradeLabel}`, "homework", homeworkId);
  } catch (err) {
    logError("notify student failed during gradeHomework", err, {
      component: "homework.gradeHomework",
      metadata: { student_id: hw.student_id, homeworkId, grade },
    });
  }

  // Auto-regeneration for needs_work / not_done
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
      if (regenErr) logError("homework auto-regen failed", regenErr, { tag: "homework" });

      // Notify student about re-assignment
      await notify(hw.student_id, "homework", "تم إعادة تكليفك بالمتابعة", `تمت إعادة تكليفك بمتابعة "${hw.title}" — يرجى المحاولة مجدداً`, "homework", homeworkId);

      // Notify parent
      await notifyParentHomeworkNotDone(
        hw.student_id,
        hw.teacher_id,
        hw.title,
        grade,
        user.id,
      );
    } catch (err) {
      logError("auto-regen branch failed during gradeHomework", err, {
        component: "homework.gradeHomework.regen",
        metadata: { student_id: hw.student_id, homeworkId, grade },
      });
    }
  }

  revalidateFollowUpPaths();
  await emitEvent("homework.graded", "homework", homeworkId, { student_id: hw.student_id, teacher_id: hw.teacher_id, grade })
    .catch((err) => logError("emit homework.graded failed", err, { tag: "automation", event: "homework.graded" }));
  return { success: true };
}

// ─── 4. Edit Homework ───────────────────────────────────────────────────────

export async function editHomework(homeworkId: string, formData: FormData) {
  const supabase = await createClient();
  const { user } = await requireTeacherOrAbove(supabase);

  // Fetch homework — pull status so we can guard against editing graded rows.
  const { data: hw } = await supabase
    .from("homework_assignments")
    .select("teacher_id, student_id, assigned_at, status")
    .eq("id", homeworkId)
    .returns<{ teacher_id: string; student_id: string; assigned_at: string; status: HomeworkStatus }[]>()
    .single();

  if (!hw) return { error: "المتابعة غير موجودة" };
  if (hw.teacher_id !== user.id) {
    const { data: p } = await supabase
      .from("profiles").select("role").eq("id", user.id)
      .single<{ role: string }>();
    if (!p || !["admin", "moderator"].includes(p.role)) {
      return { error: "غير مصرح" };
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
    return { error: "لا يمكن تعديل متابعة تم تقييمها. للتغيير، أنشئ متابعة جديدة." };
  }

  // Check edit window: find next session between same teacher+student
  const { data: nextBooking } = await supabase
    .from("bookings")
    .select("id")
    .eq("teacher_id", hw.teacher_id)
    .eq("student_id", hw.student_id)
    .eq("status", "confirmed")
    .gt("scheduled_at", hw.assigned_at)
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .single<{ id: string }>();

  if (nextBooking) {
    const { data: nextSession } = await supabase
      .from("sessions")
      .select("started_at")
      .eq("booking_id", nextBooking.id)
      .single<{ started_at: string | null }>();

    if (nextSession?.started_at) {
      return { error: "انتهت فترة التعديل — بدأت الجلسة التالية" };
    }
  }

  // Build update object
  const updates: Record<string, unknown> = {};
  const title = formData.get("title") as string;
  if (title) updates.title = title;
  const description = formData.get("description") as string;
  if (description !== null) updates.description = description || null;
  const homework_type = formData.get("homework_type") as string;
  if (homework_type) updates.homework_type = homework_type;
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

  updates.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("homework_assignments")
    .update(updates as never)
    .eq("id", homeworkId);

  if (error) return { error: "فشل تعديل المتابعة" };

  revalidateFollowUpPaths();
  return { success: true };
}

// ─── 5. Get Homework Audio Signed URL ───────────────────────────────────────
// The homework-audio bucket is private; playback requires a short-lived
// signed URL. Storage RLS gates which paths the caller can sign — student
// can sign their own, teacher can sign for any homework_assignments row
// they own, admin/mod can sign all. The action just bridges from the
// authenticated server-side client to the browser's <audio> element.

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

// ─── 6. Delete Homework ─────────────────────────────────────────────────────

export async function deleteHomework(homeworkId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };

  // Fetch homework
  const { data: hw } = await supabase
    .from("homework_assignments")
    .select("teacher_id")
    .eq("id", homeworkId)
    .returns<{ teacher_id: string }[]>()
    .single();

  if (!hw) return { error: "المتابعة غير موجودة" };

  // Verify ownership or admin/mod
  if (hw.teacher_id !== user.id) {
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id)
      .single<{ role: string }>();
    if (!profile || !["admin", "moderator"].includes(profile.role)) {
      return { error: "ليس لديك صلاحية" };
    }
  }

  // Count + delete children (auto-regenerated assignments) first.
  // Without this audit trail, a teacher deleting a parent homework would
  // silently delete N regenerated child assignments — the student would
  // see them disappear from /student/homework with no explanation.
  // We log how many we cascaded so admins can trace "where did those go".
  const { data: children } = await supabase
    .from("homework_assignments")
    .select("id, status, title")
    .eq("parent_assignment_id", homeworkId)
    .returns<{ id: string; status: string; title: string }[]>();
  const childCount = children?.length ?? 0;

  if (childCount > 0) {
    await supabase
      .from("homework_assignments")
      .delete()
      .eq("parent_assignment_id", homeworkId);
  }

  // Delete the homework
  const { error } = await supabase
    .from("homework_assignments")
    .delete()
    .eq("id", homeworkId);

  if (error) return { error: "فشل حذف المتابعة" };

  // Audit log the deletion + cascade size. Best-effort: an audit_log
  // insert failure must never block the delete itself succeeding.
  await supabase
    .from("audit_log")
    .insert({
      actor_id: user.id,
      action: "DELETE",
      table_name: "homework_assignments",
      record_id: homeworkId,
      metadata: { cascaded_children: childCount, child_ids: children?.map((c) => c.id) ?? [] },
    } as never)
    .then((r) => {
      if (r.error) logError("audit_log insert failed for homework delete", r.error, {
        tag: "audit", homeworkId, childCount,
      });
    });

  revalidateFollowUpPaths();
  return { success: true };
}
