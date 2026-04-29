import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createQuiz } from "@/lib/actions/quizzes";

export const metadata: Metadata = { title: "اختبار جديد" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function NewQuizPage({ params }: Props) {
  const { id: courseId } = await params;

  async function action(formData: FormData) {
    "use server";
    const res = await createQuiz(courseId, formData);
    if (res.ok && res.id) {
      redirect(`/teacher/courses/${courseId}/quizzes/${res.id}/edit`);
    }
    // Error handling: redirect back with no id; teacher edit page expects an id.
    redirect(`/teacher/courses/${courseId}/quizzes`);
  }

  // Verify access
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: course } = await supabase.from("courses").select("id, title_ar, teacher_id").eq("id", courseId).single<{ id: string; title_ar: string; teacher_id: string }>();
  if (!course) notFound();
  if (course.teacher_id !== user.id) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
    if (profile?.role !== "admin" && profile?.role !== "moderator") redirect("/teacher/courses");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 font-display text-xl font-bold sm:text-2xl">اختبار جديد · New Quiz</h1>
      <form action={action} className="glass-card space-y-3 p-6">
        <input required name="title_ar" placeholder="العنوان بالعربية *" className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
        <input name="title_en" placeholder="Title (English)" className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
        <textarea name="description_ar" rows={2} placeholder="الوصف بالعربية" className="glass-input w-full rounded-lg px-3 py-2 text-sm" />
        <div className="grid gap-3 sm:grid-cols-3">
          <input type="number" name="time_limit_minutes" min={1} placeholder="Time limit (min)" className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
          <input type="number" name="passing_score_pct" min={0} max={100} defaultValue={70} placeholder="Pass %" className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
          <input type="datetime-local" name="due_at" placeholder="Due" className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" name="is_published" className="h-4 w-4 cursor-pointer accent-[var(--gold)]" />
          منشور · Published
        </label>
        <button type="submit" className="glass-gold glass-pill px-6 py-2 text-sm font-semibold">
          إنشاء · Create
        </button>
      </form>
    </div>
  );
}
