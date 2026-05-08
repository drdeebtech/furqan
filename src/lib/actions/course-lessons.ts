"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";
import { logError } from "@/lib/logger";
import {
  createVideo as createBunnyVideo,
  deleteVideo as deleteBunnyVideo,
  getTusUploadSignature,
  getVideo as getBunnyVideo,
  bunnyStatusToVideoStatus,
  isBunnyConfigured,
} from "@/lib/bunny/client";
import type { CourseLesson } from "@/types/database";

async function requireTeacherOrAbove(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("غير مسجل الدخول");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (
    !profile ||
    !["admin", "teacher"].includes(profile.role)
  ) {
    throw new Error("غير مصرح");
  }
  return { user, role: profile.role };
}

function revalidateCoursePaths(courseId?: string) {
  revalidatePath("/teacher/courses");
  if (courseId) revalidatePath(`/teacher/courses/${courseId}`);
}

// ─── 1. createLesson ────────────────────────────────────────────────────────
// Provisions a Bunny video record and creates the local lesson row in
// 'uploading' state. Returns the TUS upload credentials so the browser can
// upload directly to Bunny without ever seeing the API key.

export interface CreateLessonResult {
  ok: boolean;
  error?: string;
  lesson?: {
    id: string;
    bunny_video_id: string;
  };
  upload?: {
    endpoint: string;
    libraryId: string;
    videoId: string;
    signature: string;
    expirationTime: number;
  };
}

export async function createLesson(
  courseId: string,
  formData: FormData,
): Promise<CreateLessonResult> {
  const supabase = await createClient();
  try {
    await requireTeacherOrAbove(supabase);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  if (!isBunnyConfigured()) {
    return {
      ok: false,
      error:
        "خدمة الفيديو غير مهيأة. اتصل بالمشرف لإعداد Bunny.net (راجع docs/bunny-setup.md).",
    };
  }

  const title_ar = String(formData.get("title_ar") ?? "").trim();
  const title_en = (formData.get("title_en") as string | null)?.trim() || null;
  const is_preview = formData.get("is_preview") === "on";

  if (!title_ar) return { ok: false, error: "العنوان بالعربية مطلوب" };

  // Determine next order_index
  const { data: existing } = await supabase
    .from("course_lessons")
    .select("order_index")
    .eq("course_id", courseId)
    .order("order_index", { ascending: false })
    .limit(1)
    .returns<{ order_index: number }[]>();
  const nextOrder = (existing?.[0]?.order_index ?? 0) + 1;

  // Provision Bunny video
  let bunnyGuid: string;
  try {
    const v = await createBunnyVideo(title_en || title_ar);
    bunnyGuid = v.guid;
  } catch (err) {
    logError("Bunny createVideo failed", err, { tag: "course-lessons", courseId });
    return { ok: false, error: "فشل إنشاء سجل الفيديو في Bunny.net" };
  }

  // Insert lesson row
  const { data: lesson, error } = await supabase
    .from("course_lessons")
    .insert({
      course_id: courseId,
      order_index: nextOrder,
      title_ar,
      title_en,
      bunny_video_id: bunnyGuid,
      video_status: "uploading",
      is_preview,
    } satisfies TableInsert<"course_lessons">)
    .select("id, bunny_video_id")
    .single<{ id: string; bunny_video_id: string }>();

  if (error || !lesson) {
    logError("createLesson db insert failed", error, {
      tag: "course-lessons",
      courseId,
      bunnyGuid,
    });
    // best-effort cleanup of the orphan Bunny video record — log if it fails
    // so we don't silently leak Bunny videos when the cleanup doesn't go
    // through.
    deleteBunnyVideo(bunnyGuid).catch((err) =>
      logError("bunny orphan cleanup failed", err, { tag: "bunny", bunnyGuid }),
    );
    return { ok: false, error: error?.message ?? "فشل إنشاء الدرس" };
  }

  const upload = getTusUploadSignature(bunnyGuid);

  // Bump course's lesson_count_cached
  await supabase
    .rpc("noop" as never)
    .then(() =>
      supabase
        .from("courses")
        .update({ lesson_count_cached: nextOrder } satisfies TableUpdate<"courses">)
        .eq("id", courseId),
    );

  revalidateCoursePaths(courseId);
  return { ok: true, lesson, upload };
}

// ─── 2. updateLesson ────────────────────────────────────────────────────────

export async function updateLesson(
  lessonId: string,
  formData: FormData,
) {
  const supabase = await createClient();
  try {
    await requireTeacherOrAbove(supabase);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  const updates: Partial<CourseLesson> = {};
  const fields: (keyof CourseLesson)[] = [
    "title_ar",
    "title_en",
    "description_ar",
    "description_en",
    "is_preview",
  ];
  for (const f of fields) {
    const v = formData.get(f as string);
    if (v !== null) {
      if (f === "is_preview") {
        (updates as Record<string, unknown>)[f] = v === "on" || v === "true";
      } else {
        (updates as Record<string, unknown>)[f] = v === "" ? null : v;
      }
    }
  }

  const { data, error } = await supabase
    .from("course_lessons")
    .update(updates as TableUpdate<"course_lessons">)
    .eq("id", lessonId)
    .select("course_id")
    .single<{ course_id: string }>();

  if (error) {
    logError("updateLesson failed", error, { tag: "course-lessons", lessonId });
    return { ok: false as const, error: error.message };
  }

  revalidateCoursePaths(data?.course_id);
  return { ok: true as const };
}

// ─── 3. deleteLesson ────────────────────────────────────────────────────────

export async function deleteLesson(lessonId: string) {
  const supabase = await createClient();
  try {
    await requireTeacherOrAbove(supabase);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  const { data: lesson } = await supabase
    .from("course_lessons")
    .select("bunny_video_id, course_id")
    .eq("id", lessonId)
    .single<{ bunny_video_id: string | null; course_id: string }>();

  const { error } = await supabase
    .from("course_lessons")
    .delete()
    .eq("id", lessonId);

  if (error) {
    logError("deleteLesson failed", error, { tag: "course-lessons", lessonId });
    return { ok: false as const, error: error.message };
  }

  if (lesson?.bunny_video_id) {
    deleteBunnyVideo(lesson.bunny_video_id).catch((err) =>
      logError("Bunny deleteVideo cleanup failed (non-fatal)", err, {
        tag: "course-lessons",
        bunnyGuid: lesson.bunny_video_id,
      }),
    );
  }

  revalidateCoursePaths(lesson?.course_id);
  return { ok: true as const };
}

// ─── 4. togglePreview ───────────────────────────────────────────────────────

export async function togglePreview(lessonId: string, isPreview: boolean) {
  const supabase = await createClient();
  try {
    await requireTeacherOrAbove(supabase);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  const { data, error } = await supabase
    .from("course_lessons")
    .update({ is_preview: isPreview } satisfies TableUpdate<"course_lessons">)
    .eq("id", lessonId)
    .select("course_id")
    .single<{ course_id: string }>();

  if (error) {
    logError("togglePreview failed", error, { tag: "course-lessons", lessonId });
    return { ok: false as const, error: error.message };
  }

  revalidateCoursePaths(data?.course_id);
  return { ok: true as const };
}

// ─── 5. syncLessonStatusFromBunny ───────────────────────────────────────────
// Webhook-less fallback: re-queries Bunny's API for the current video status
// and updates the lesson row. Useful when the webhook isn't configured (e.g.
// BUNNY_WEBHOOK_SECRET missing) or when the webhook hasn't arrived yet.
// Idempotent — calling it on a 'ready' lesson is a no-op.

export async function syncLessonStatusFromBunny(lessonId: string) {
  const supabase = await createClient();
  try {
    await requireTeacherOrAbove(supabase);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  if (!isBunnyConfigured()) {
    return { ok: false as const, error: "Bunny.net غير مهيأ" };
  }

  const { data: lesson } = await supabase
    .from("course_lessons")
    .select("id, course_id, bunny_video_id, video_status")
    .eq("id", lessonId)
    .single<{
      id: string;
      course_id: string;
      bunny_video_id: string | null;
      video_status: string;
    }>();

  if (!lesson || !lesson.bunny_video_id) {
    return { ok: false as const, error: "الدرس غير موجود" };
  }

  if (lesson.video_status === "ready" || lesson.video_status === "failed") {
    return {
      ok: true as const,
      videoStatus: lesson.video_status as "ready" | "failed",
      changed: false,
    };
  }

  let info;
  try {
    info = await getBunnyVideo(lesson.bunny_video_id);
  } catch (err) {
    logError("syncLessonStatusFromBunny: getBunnyVideo failed", err, {
      tag: "course-lessons",
      lessonId,
    });
    return { ok: false as const, error: "تعذر الاتصال بـ Bunny.net" };
  }

  const newStatus = bunnyStatusToVideoStatus(info.status);
  // Non-status events (CaptionsGenerated etc.) → no transition, return current.
  if (newStatus === null) {
    return {
      ok: true as const,
      videoStatus: lesson.video_status as
        | "uploading"
        | "processing"
        | "ready"
        | "failed",
      changed: false,
    };
  }
  const updates: Record<string, unknown> = { video_status: newStatus };
  if (info.length && info.length > 0) {
    updates.duration_seconds = Math.round(info.length);
  }

  const { error } = await supabase
    .from("course_lessons")
    .update(updates as TableUpdate<"course_lessons">)
    .eq("id", lessonId);

  if (error) {
    logError("syncLessonStatusFromBunny: update failed", error, {
      tag: "course-lessons",
      lessonId,
    });
    return { ok: false as const, error: error.message };
  }

  // Recompute course duration if newly ready
  if (newStatus === "ready") {
    try {
      const { data: readyLessons } = await supabase
        .from("course_lessons")
        .select("duration_seconds")
        .eq("course_id", lesson.course_id)
        .eq("video_status", "ready");
      if (readyLessons) {
        const totalDuration = readyLessons.reduce(
          (sum, l) => sum + (l.duration_seconds ?? 0),
          0,
        );
        await supabase
          .from("courses")
          .update({ duration_seconds_cached: totalDuration } satisfies TableUpdate<"courses">)
          .eq("id", lesson.course_id);
      }
    } catch {
      // best-effort; non-fatal
    }
  }

  revalidateCoursePaths(lesson.course_id);
  return {
    ok: true as const,
    videoStatus: newStatus as "uploading" | "processing" | "ready" | "failed",
    changed: newStatus !== lesson.video_status,
  };
}

// ─── 6. reorderLessons ──────────────────────────────────────────────────────
// Two-pass strategy avoids unique(course_id, order_index) collisions:
// pass 1 sets all rows to negative temp values, pass 2 sets the final values.

export async function reorderLessons(
  courseId: string,
  orderedLessonIds: string[],
) {
  const supabase = await createClient();
  try {
    await requireTeacherOrAbove(supabase);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  for (let i = 0; i < orderedLessonIds.length; i++) {
    const { error } = await supabase
      .from("course_lessons")
      .update({ order_index: -(i + 1000) } satisfies TableUpdate<"course_lessons">)
      .eq("id", orderedLessonIds[i])
      .eq("course_id", courseId);
    if (error) {
      logError("reorderLessons pass1 failed", error, {
        tag: "course-lessons",
        courseId,
      });
      return { ok: false as const, error: error.message };
    }
  }

  for (let i = 0; i < orderedLessonIds.length; i++) {
    const { error } = await supabase
      .from("course_lessons")
      .update({ order_index: i + 1 } satisfies TableUpdate<"course_lessons">)
      .eq("id", orderedLessonIds[i])
      .eq("course_id", courseId);
    if (error) {
      logError("reorderLessons pass2 failed", error, {
        tag: "course-lessons",
        courseId,
      });
      return { ok: false as const, error: error.message };
    }
  }

  revalidateCoursePaths(courseId);
  return { ok: true as const };
}
