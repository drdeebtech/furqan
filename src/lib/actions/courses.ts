"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import { notify } from "@/lib/notifications/dispatcher";
import { syncLessonStatusFromBunny } from "@/lib/actions/course-lessons";
import type {
  Course,
  CoursePricingType,
  CourseLevel,
  CourseLanguage,
  CourseCurrency,
  CourseOwnership,
} from "@/types/database";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

// ─── Auth helpers ───────────────────────────────────────────────────────────

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

async function requireAdminOrMod(
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
  if (!profile || !["admin"].includes(profile.role)) {
    throw new Error("غير مصرح");
  }
  return { user, role: profile.role };
}

// Slug generator: lowercase, hyphenated, transliterated (Arabic supported via passthrough).
// Adds incremental -N suffix on collision.
function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w؀-ۿ\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 80) || "course"
  );
}

async function uniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  base: string,
): Promise<string> {
  const { data } = await supabase
    .from("courses")
    .select("slug")
    .like("slug", `${base}%`)
    .returns<{ slug: string }[]>();
  const existing = new Set((data ?? []).map((r) => r.slug));
  if (!existing.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Could not allocate unique slug");
}

function revalidateCoursePaths(courseId?: string, slug?: string) {
  revalidatePath("/teacher/courses");
  revalidatePath("/admin/courses");
  revalidatePath("/courses");
  if (courseId) revalidatePath(`/teacher/courses/${courseId}`);
  if (courseId) revalidatePath(`/admin/courses/${courseId}`);
  if (slug) revalidatePath(`/courses/${slug}`);
}

// ─── 1. createCourse ────────────────────────────────────────────────────────

export type CreateCourseResult =
  | { ok: true; courseId: string }
  | { ok: false; error: string };

export async function createCourse(formData: FormData): Promise<CreateCourseResult> {
  const supabase = await createClient();
  let actor: { id: string };
  try {
    // Course creation is now admin/moderator-only — staff create courses on
    // behalf of teachers, the teacher field is selected in the form rather
    // than inferred from the session. RLS migration 20260430085907 enforces
    // the same restriction at the database level.
    actor = (await requireAdminOrMod(supabase)).user;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Ownership branch — platform-owned courses have no teacher and never
  // pay out a share. Default 'teacher' keeps the existing form-without-radio
  // path working (radio defaults to teacher in the new admin UI).
  const ownershipRaw = String(formData.get("ownership") ?? "teacher");
  if (ownershipRaw !== "platform" && ownershipRaw !== "teacher") {
    return { ok: false, error: "نوع ملكية الدورة غير صالح" };
  }
  const ownership = ownershipRaw as CourseOwnership;

  const teacher_id_raw = String(formData.get("teacher_id") ?? "").trim();
  const teacher_id = ownership === "platform" ? null : teacher_id_raw;
  const title_ar = String(formData.get("title_ar") ?? "").trim();
  const title_en = (formData.get("title_en") as string | null)?.trim() || null;
  const description_ar = (formData.get("description_ar") as string | null) ?? null;
  const description_en = (formData.get("description_en") as string | null) ?? null;
  const level = (formData.get("level") as CourseLevel | null) ?? null;
  const language = (formData.get("language") as CourseLanguage | null) ?? null;
  const specialty = (formData.get("specialty") as string | null) ?? null;
  const pricing_type = (formData.get("pricing_type") as CoursePricingType) || "free";
  const price_cents = Number(formData.get("price_cents") ?? 0) | 0;
  const currency = (formData.get("currency") as CourseCurrency) || "USD";

  // Optional admin override of the teacher revenue split (basis points,
  // 0–10000). Falls back to 7000 (70%) when not supplied. Always 0 for
  // platform-owned rows — the DB CHECK enforces this independently.
  const shareBpsRaw = formData.get("teacher_revenue_share_bps");
  const shareBpsParsed = shareBpsRaw !== null ? Number(shareBpsRaw) | 0 : 7000;
  const teacher_revenue_share_bps =
    ownership === "platform"
      ? 0
      : Math.max(0, Math.min(10000, shareBpsParsed));

  if (ownership === "teacher" && !teacher_id) {
    return { ok: false, error: "اختر المعلم المالك للدورة" };
  }
  if (!title_ar) return { ok: false, error: "العنوان بالعربية مطلوب" };
  if (pricing_type === "one_time" && price_cents <= 0) {
    return { ok: false, error: "السعر مطلوب للدورات المدفوعة" };
  }

  // Verify the selected teacher_id actually belongs to a teacher account —
  // we won't trust the form value blindly even though admin/mod is gating
  // the call. Stops accidental assignment to a student/admin id.
  if (ownership === "teacher") {
    const { data: teacherRow } = await supabase
      .from("profiles")
      .select("role, deleted_at")
      .eq("id", teacher_id as string)
      .single<{ role: string; deleted_at: string | null }>();
    if (!teacherRow || teacherRow.role !== "teacher" || teacherRow.deleted_at) {
      return { ok: false, error: "المعلم المختار غير صالح" };
    }
  }

  const baseSlug = slugify(title_en || title_ar);
  const slug = await uniqueSlug(supabase, baseSlug);

  const { data, error } = await supabase
    .from("courses")
    .insert({
      teacher_id,
      ownership,
      teacher_revenue_share_bps,
      slug,
      title_ar,
      title_en,
      description_ar,
      description_en,
      level,
      language,
      specialty,
      pricing_type,
      price_cents: pricing_type === "free" ? 0 : price_cents,
      currency,
      status: "draft",
    } satisfies TableInsert<"courses">)
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    logError("createCourse failed", error, { tag: "courses", actorId: actor.id, teacherId: teacher_id });
    return { ok: false, error: error?.message ?? "فشل إنشاء الدورة" };
  }

  // Best-effort audit trail: persist who created the course and which
  // ownership mode it was filed under. Non-blocking — a failed audit write
  // surfaces in logError but never breaks the flow.
  await supabase
    .from("audit_log")
    .insert({
      changed_by: actor.id,
      action: "INSERT",
      table_name: "courses",
      record_id: data.id,
      new_data: {
        ownership,
        teacher_id,
        teacher_revenue_share_bps,
        pricing_type,
        price_cents: pricing_type === "free" ? 0 : price_cents,
      },
    } as TableInsert<"audit_log">)
    .then(({ error: auditErr }) => {
      if (auditErr) {
        logError("audit insert failed", auditErr, {
          tag: "audit",
          courseId: data.id,
        });
      }
    });

  revalidateCoursePaths(data.id, slug);
  redirect(`/admin/courses/${data.id}`);
}

// ─── 2. updateCourse ────────────────────────────────────────────────────────

export type UpdateCourseResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateCourse(
  courseId: string,
  formData: FormData,
): Promise<UpdateCourseResult> {
  const supabase = await createClient();
  try {
    await requireTeacherOrAbove(supabase);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const updates: TableUpdate<"courses"> = {};
  const fields: (keyof Course)[] = [
    "title_ar",
    "title_en",
    "description_ar",
    "description_en",
    "cover_image_url",
    "level",
    "language",
    "specialty",
  ];
  for (const f of fields) {
    const v = formData.get(f as string);
    if (v !== null) (updates as Record<string, unknown>)[f] = v === "" ? null : v;
  }

  const pricing_type = formData.get("pricing_type");
  if (pricing_type) {
    updates.pricing_type = pricing_type as CoursePricingType;
    const price_cents = Number(formData.get("price_cents") ?? 0) | 0;
    updates.price_cents = pricing_type === "free" ? 0 : price_cents;
    const currency = (formData.get("currency") as CourseCurrency) || "USD";
    updates.currency = currency;
  }

  // Ownership flip is only allowed while the course is still a draft —
  // changing the revenue model after enrollments exist would silently
  // rewrite past payouts. The DB CHECK still guards the final shape.
  const ownershipRaw = formData.get("ownership");
  if (ownershipRaw !== null) {
    if (ownershipRaw !== "platform" && ownershipRaw !== "teacher") {
      return { ok: false, error: "نوع ملكية الدورة غير صالح" };
    }
    const { data: current } = await supabase
      .from("courses")
      .select("status, ownership")
      .eq("id", courseId)
      .single<{ status: string; ownership: CourseOwnership }>();
    if (!current) return { ok: false, error: "الدورة غير موجودة" };
    if (current.ownership !== ownershipRaw && current.status !== "draft") {
      return {
        ok: false,
        error:
          "لا يمكن تغيير نوع الملكية بعد إرسال الدورة للمراجعة — أرشفها وأنشئ نسخة جديدة بدل ذلك",
      };
    }
    if (ownershipRaw === "platform") {
      updates.ownership = "platform";
      updates.teacher_id = null;
      updates.teacher_revenue_share_bps = 0;
    } else {
      const newTeacherId = String(formData.get("teacher_id") ?? "").trim();
      if (!newTeacherId) {
        return { ok: false, error: "اختر المعلم المالك للدورة" };
      }
      const { data: teacherRow } = await supabase
        .from("profiles")
        .select("role, deleted_at")
        .eq("id", newTeacherId)
        .single<{ role: string; deleted_at: string | null }>();
      if (!teacherRow || teacherRow.role !== "teacher" || teacherRow.deleted_at) {
        return { ok: false, error: "المعلم المختار غير صالح" };
      }
      updates.ownership = "teacher";
      updates.teacher_id = newTeacherId;
    }
  }

  const shareBpsRaw = formData.get("teacher_revenue_share_bps");
  if (shareBpsRaw !== null && updates.ownership !== "platform") {
    const bps = Math.max(0, Math.min(10000, Number(shareBpsRaw) | 0));
    updates.teacher_revenue_share_bps = bps;
  }

  const { error } = await supabase
    .from("courses")
    .update(updates)
    .eq("id", courseId);

  if (error) {
    logError("updateCourse failed", error, { tag: "courses", courseId });
    return { ok: false, error: error.message };
  }

  revalidateCoursePaths(courseId);
  return { ok: true };
}

// ─── 3. submitForReview ─────────────────────────────────────────────────────

export type SubmitForReviewResult =
  | { ok: true }
  | { ok: false; error: string };

export async function submitForReview(
  courseId: string,
): Promise<SubmitForReviewResult> {
  const supabase = await createClient();
  try {
    await requireTeacherOrAbove(supabase);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Pre-flight: course must have ≥1 lesson, all lessons must be 'ready',
  // and (if paid) ≥1 lesson must be is_preview=true.
  const { data: course } = await supabase
    .from("courses")
    .select("pricing_type, status")
    .eq("id", courseId)
    .single<{ pricing_type: CoursePricingType; status: string }>();

  if (!course) return { ok: false, error: "الدورة غير موجودة" };
  if (!["draft", "rejected"].includes(course.status)) {
    return { ok: false, error: "لا يمكن إرسال دورة بحالتها الحالية للمراجعة" };
  }

  const { data: lessons } = await supabase
    .from("course_lessons")
    .select("id, video_status, is_preview")
    .eq("course_id", courseId)
    .returns<{ id: string; video_status: string; is_preview: boolean }[]>();

  if (!lessons || lessons.length === 0) {
    return { ok: false, error: "أضف درساً واحداً على الأقل قبل الإرسال" };
  }

  // Auto-sync any lesson not yet 'ready' against Bunny — covers the case where
  // the webhook never arrived (e.g. BUNNY_WEBHOOK_SECRET missing or webhook
  // not configured). Updates the row in place; we then re-check the local set.
  const notReadyIds = lessons.filter((l) => l.video_status !== "ready").map((l) => l.id);
  if (notReadyIds.length > 0) {
    await Promise.all(
      notReadyIds.map((lid) =>
        syncLessonStatusFromBunny(lid).catch((err) => {
          logError("bunny status sync failed", err, { tag: "bunny", lessonId: lid });
          return null;
        }),
      ),
    );
    const { data: refreshed } = await supabase
      .from("course_lessons")
      .select("id, video_status, is_preview")
      .eq("course_id", courseId)
      .returns<{ id: string; video_status: string; is_preview: boolean }[]>();
    if (refreshed) {
      lessons.length = 0;
      lessons.push(...refreshed);
    }
  }

  const notReady = lessons.filter((l) => l.video_status !== "ready");
  if (notReady.length > 0) {
    return {
      ok: false,
      error: `${notReady.length} درس لا يزال قيد المعالجة — انتظر اكتمالها (قد يستغرق ٢-٥ دقائق بعد الرفع)`,
    };
  }

  if (course.pricing_type === "one_time") {
    const hasPreview = lessons.some((l) => l.is_preview);
    if (!hasPreview) {
      return {
        ok: false,
        error: "الدورات المدفوعة يجب أن تحتوي على درس عرض مجاني (preview) واحد على الأقل",
      };
    }
  }

  const { error } = await supabase
    .from("courses")
    .update({ status: "pending_review", rejection_reason: null } satisfies TableUpdate<"courses">)
    .eq("id", courseId);

  if (error) {
    logError("submitForReview failed", error, { tag: "courses", courseId });
    return { ok: false, error: error.message };
  }

  // Fan-out notification to all admins + moderators (also feeds the
  // course.submitted event payload so n8n can route teacher-vs-platform).
  const { data: courseRow } = await supabase
    .from("courses")
    .select("title_ar, ownership, teacher_id")
    .eq("id", courseId)
    .single<{ title_ar: string; ownership: CourseOwnership; teacher_id: string | null }>();

  await emitEvent("course.submitted", "course", courseId, {
    ownership: courseRow?.ownership ?? "teacher",
    teacher_id: courseRow?.teacher_id ?? null,
  }).catch((err) =>
    logError("emit course.submitted failed", err, { tag: "courses", courseId }),
  );

  const { data: reviewers } = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["admin"])
    .returns<{ id: string }[]>();
  for (const r of reviewers ?? []) {
    await notify({
      userId: r.id,
      type: "course",
      title: "دورة بانتظار المراجعة",
      body: `الدورة "${courseRow?.title_ar ?? ""}" مرفوعة للمراجعة`,
      entityType: "course",
      entityId: courseId,
    }).catch((err) => logError("notify on submit failed", err, { tag: "courses", courseId, recipient: r.id }));
  }

  revalidateCoursePaths(courseId);
  return { ok: true };
}

// ─── 4. approveCourse / rejectCourse / archiveCourse (admin/mod) ────────────

export async function approveCourse(courseId: string) {
  const supabase = await createClient();
  let admin: { id: string };
  try {
    admin = (await requireAdminOrMod(supabase)).user;
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  const { error } = await supabase
    .from("courses")
    .update({
      status: "published",
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
      rejection_reason: null,
    } satisfies TableUpdate<"courses">)
    .eq("id", courseId);

  if (error) {
    logError("approveCourse failed", error, { tag: "courses", courseId });
    return { ok: false as const, error: error.message };
  }

  // Read once, use for both the event payload and the (optional) teacher
  // notification. n8n routes on `ownership` to pick the correct downstream.
  const { data: course } = await supabase
    .from("courses")
    .select("teacher_id, title_ar, ownership")
    .eq("id", courseId)
    .single<{ teacher_id: string | null; title_ar: string; ownership: CourseOwnership }>();

  await emitEvent(
    "course.approved",
    "course",
    courseId,
    {
      ownership: course?.ownership ?? "teacher",
      teacher_id: course?.teacher_id ?? null,
    },
    admin.id,
  ).catch((err) =>
    logError("emit course.approved failed", err, { tag: "courses", courseId }),
  );

  // Notify the teacher when there is one. Platform-owned courses have no
  // teacher to ping — the n8n admin digest picks up the course.approved
  // event for those.
  if (course?.teacher_id) {
    await notify({
      userId: course.teacher_id,
      type: "course",
      title: "تمت الموافقة على دورتك",
      body: `الدورة "${course.title_ar}" منشورة الآن للطلاب`,
      entityType: "course",
      entityId: courseId,
    }).catch((err) => logError("notify on approve failed", err, { tag: "courses", courseId }));
  }

  revalidateCoursePaths(courseId);
  return { ok: true as const };
}

export async function rejectCourse(courseId: string, reason: string) {
  const supabase = await createClient();
  let admin: { id: string };
  try {
    admin = (await requireAdminOrMod(supabase)).user;
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  if (!reason.trim()) return { ok: false as const, error: "سبب الرفض مطلوب" };

  const { error } = await supabase
    .from("courses")
    .update({
      status: "rejected",
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason.trim(),
    } satisfies TableUpdate<"courses">)
    .eq("id", courseId);

  if (error) {
    logError("rejectCourse failed", error, { tag: "courses", courseId });
    return { ok: false as const, error: error.message };
  }

  // Read once, use for both the event payload and the (optional) teacher
  // notification.
  const { data: course } = await supabase
    .from("courses")
    .select("teacher_id, title_ar, ownership")
    .eq("id", courseId)
    .single<{ teacher_id: string | null; title_ar: string; ownership: CourseOwnership }>();

  await emitEvent(
    "course.rejected",
    "course",
    courseId,
    {
      reason: reason.trim(),
      ownership: course?.ownership ?? "teacher",
      teacher_id: course?.teacher_id ?? null,
    },
    admin.id,
  ).catch((err) =>
    logError("emit course.rejected failed", err, { tag: "courses", courseId }),
  );

  // Notify the teacher with the reason — platform-owned courses skip this
  // (no teacher attached); admins see the rejection in the dashboard list.
  if (course?.teacher_id) {
    await notify({
      userId: course.teacher_id,
      type: "course",
      title: "تم رفض دورتك",
      body: `${course.title_ar} — السبب: ${reason.trim()}`,
      entityType: "course",
      entityId: courseId,
    }).catch((err) => logError("notify on reject failed", err, { tag: "courses", courseId }));
  }

  revalidateCoursePaths(courseId);
  return { ok: true as const };
}

export async function archiveCourse(courseId: string) {
  const supabase = await createClient();
  try {
    await requireAdminOrMod(supabase);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  const { error } = await supabase
    .from("courses")
    .update({ status: "archived" } satisfies TableUpdate<"courses">)
    .eq("id", courseId);

  if (error) {
    logError("archiveCourse failed", error, { tag: "courses", courseId });
    return { ok: false as const, error: error.message };
  }

  revalidateCoursePaths(courseId);
  return { ok: true as const };
}

// ─── 5. deleteCourse (teacher: drafts only) ─────────────────────────────────

export async function deleteCourse(courseId: string) {
  const supabase = await createClient();
  try {
    await requireTeacherOrAbove(supabase);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }

  const { error } = await supabase.from("courses").delete().eq("id", courseId);

  if (error) {
    logError("deleteCourse failed", error, { tag: "courses", courseId });
    return { ok: false as const, error: error.message };
  }

  revalidateCoursePaths();
  redirect("/teacher/courses");
}
