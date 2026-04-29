"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { emitEvent } from "@/lib/automation/emit";
import type {
  Course,
  CoursePricingType,
  CourseLevel,
  CourseLanguage,
  CourseCurrency,
} from "@/types/database";

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
    !["admin", "moderator", "teacher"].includes(profile.role)
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
  if (!profile || !["admin", "moderator"].includes(profile.role)) {
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
  revalidatePath("/moderator/courses");
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
  let user: { id: string };
  try {
    user = (await requireTeacherOrAbove(supabase)).user;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

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

  if (!title_ar) return { ok: false, error: "العنوان بالعربية مطلوب" };
  if (pricing_type === "one_time" && price_cents <= 0) {
    return { ok: false, error: "السعر مطلوب للدورات المدفوعة" };
  }

  const baseSlug = slugify(title_en || title_ar);
  const slug = await uniqueSlug(supabase, baseSlug);

  const { data, error } = await supabase
    .from("courses")
    .insert({
      teacher_id: user.id,
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
    } as never)
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    logError("createCourse failed", error, { tag: "courses", userId: user.id });
    return { ok: false, error: error?.message ?? "فشل إنشاء الدورة" };
  }

  revalidateCoursePaths(data.id, slug);
  redirect(`/teacher/courses/${data.id}`);
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

  const updates: Partial<Course> = {};
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

  const { error } = await supabase
    .from("courses")
    .update(updates as never)
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

  const notReady = lessons.filter((l) => l.video_status !== "ready");
  if (notReady.length > 0) {
    return {
      ok: false,
      error: `${notReady.length} درس لا يزال قيد المعالجة — انتظر اكتمالها`,
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
    .update({ status: "pending_review", rejection_reason: null } as never)
    .eq("id", courseId);

  if (error) {
    logError("submitForReview failed", error, { tag: "courses", courseId });
    return { ok: false, error: error.message };
  }

  await emitEvent("course.submitted", "course", courseId, {}).catch((err) =>
    logError("emit course.submitted failed", err, { tag: "courses", courseId }),
  );

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
    } as never)
    .eq("id", courseId);

  if (error) {
    logError("approveCourse failed", error, { tag: "courses", courseId });
    return { ok: false as const, error: error.message };
  }

  await emitEvent("course.approved", "course", courseId, {}, admin.id).catch((err) =>
    logError("emit course.approved failed", err, { tag: "courses", courseId }),
  );

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
    } as never)
    .eq("id", courseId);

  if (error) {
    logError("rejectCourse failed", error, { tag: "courses", courseId });
    return { ok: false as const, error: error.message };
  }

  await emitEvent("course.rejected", "course", courseId, {
    reason: reason.trim(),
  }, admin.id).catch((err) =>
    logError("emit course.rejected failed", err, { tag: "courses", courseId }),
  );

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
    .update({ status: "archived" } as never)
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
