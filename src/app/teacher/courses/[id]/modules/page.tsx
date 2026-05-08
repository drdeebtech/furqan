import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { isFeatureEnabled } from "@/lib/settings";
import { ModulesEditor } from "./modules-editor";

export const metadata: Metadata = { title: "وحدات الدورة" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CourseModulesPage({ params }: Props) {
  if (!(await isFeatureEnabled("modules_enabled"))) notFound();

  const { id: courseId } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: course } = await supabase
    .from("courses")
    .select("id, title_ar, title_en, teacher_id")
    .eq("id", courseId)
    .single<{ id: string; title_ar: string; title_en: string | null; teacher_id: string }>();
  if (!course) notFound();

  // Authorize: teacher owns or admin/mod
  if (course.teacher_id !== user.id) {
    const { data: profile } = await supabase
      .from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
    if (profile?.role !== "admin") {
      redirect("/teacher/courses");
    }
  }

  const [modulesRes, lessonsRes, assignmentsRes] = await Promise.all([
    supabase.from("modules")
      .select("id, title_ar, title_en, description_ar, description_en, is_linear, sort_order")
      .eq("course_id", courseId)
      .order("sort_order", { ascending: true })
      .returns<{ id: string; title_ar: string; title_en: string | null; description_ar: string | null; description_en: string | null; is_linear: boolean; sort_order: number }[]>(),
    supabase.from("course_lessons")
      .select("id, title_ar, title_en, order_index")
      .eq("course_id", courseId)
      .order("order_index", { ascending: true })
      .returns<{ id: string; title_ar: string; title_en: string | null; order_index: number }[]>(),
    supabase.from("module_lessons")
      .select("module_id, lesson_id, sort_order")
      .returns<{ module_id: string; lesson_id: string; sort_order: number }[]>(),
  ]);

  const modules = modulesRes.data ?? [];
  const lessons = lessonsRes.data ?? [];
  const allAssignments = assignmentsRes.data ?? [];
  // Filter assignments to lessons in this course
  const lessonIds = new Set(lessons.map((l) => l.id));
  const assignments = allAssignments.filter((a) => lessonIds.has(a.lesson_id));

  const Arrow = dir === "rtl" ? ArrowRight : ArrowLeft;
  const courseTitle = lang === "ar" ? course.title_ar : (course.title_en ?? course.title_ar);

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <Link
        href={`/teacher/courses/${courseId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <Arrow size={14} aria-hidden="true" />
        {courseTitle}
      </Link>

      <h1 className="mb-2 font-display text-xl font-bold sm:text-2xl">
        {t("الوحدات", "Modules")}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {t("جمّع الدروس في وحدات. عند تفعيل الترتيب الخطي، يجب على الطالب إكمال درس قبل فتح التالي.",
           "Group lessons into modules. When linear is on, students must complete each lesson before unlocking the next.")}
      </p>

      <ModulesEditor
        courseId={courseId}
        modules={modules}
        lessons={lessons}
        assignments={assignments}
      />
    </div>
  );
}
