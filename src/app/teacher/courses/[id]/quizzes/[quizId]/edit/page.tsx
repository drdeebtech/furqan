import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { QuizEditor } from "./quiz-editor";

export const metadata: Metadata = { title: "تعديل اختبار" };

interface Props {
  params: Promise<{ id: string; quizId: string }>;
}

export default async function EditQuizPage({ params }: Props) {
  const { id: courseId, quizId } = await params;
  const { dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [quizRes, questionsRes] = await Promise.all([
    supabase.from("quizzes")
      .select("id, title_ar, title_en, description_ar, description_en, time_limit_minutes, passing_score_pct, available_at, due_at, is_published, course_id")
      .eq("id", quizId)
      .single<{
        id: string;
        title_ar: string; title_en: string | null;
        description_ar: string | null; description_en: string | null;
        time_limit_minutes: number | null;
        passing_score_pct: number;
        available_at: string | null; due_at: string | null;
        is_published: boolean;
        course_id: string;
      }>(),
    supabase.from("quiz_questions")
      .select("id, question_ar, question_en, question_type, options, correct_answer, points, sort_order")
      .eq("quiz_id", quizId)
      .order("sort_order", { ascending: true })
      .returns<{
        id: string;
        question_ar: string; question_en: string | null;
        question_type: string;
        options: { id: string; text_ar: string }[] | null;
        correct_answer: { mcq?: string; fill_in?: string[]; true_false?: boolean };
        points: number; sort_order: number;
      }[]>(),
  ]);

  if (!quizRes.data || quizRes.data.course_id !== courseId) notFound();
  const quiz = quizRes.data;

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link href={`/teacher/courses/${courseId}/quizzes`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground">
        {dir === "rtl" ? <ArrowRight size={14} aria-hidden="true" /> : <ArrowLeft size={14} aria-hidden="true" />}
        Quizzes
      </Link>

      <QuizEditor quiz={quiz} questions={questionsRes.data ?? []} courseId={courseId} />
    </div>
  );
}
