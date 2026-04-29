import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isFeatureEnabled } from "@/lib/settings";
import { startQuizAttempt } from "@/lib/actions/quizzes";
import { QuizTaker } from "./quiz-taker";

export const metadata: Metadata = { title: "خوض الاختبار" };

interface Props {
  params: Promise<{ quizId: string }>;
}

export default async function TakeQuizPage({ params }: Props) {
  if (!(await isFeatureEnabled("quizzes_enabled"))) notFound();

  const { quizId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: quiz } = await supabase.from("quizzes")
    .select("id, title_ar, title_en, time_limit_minutes, passing_score_pct, is_published")
    .eq("id", quizId)
    .single<{ id: string; title_ar: string; title_en: string | null; time_limit_minutes: number | null; passing_score_pct: number; is_published: boolean }>();
  if (!quiz || !quiz.is_published) notFound();

  const { data: questions } = await supabase.from("quiz_questions")
    .select("id, question_ar, question_en, question_type, options, points")
    .eq("quiz_id", quizId)
    .order("sort_order", { ascending: true })
    .returns<{
      id: string;
      question_ar: string; question_en: string | null;
      question_type: string;
      options: { id: string; text_ar: string }[] | null;
      points: number;
    }[]>();

  // Start (or resume) attempt
  const startRes = await startQuizAttempt(quizId);
  if (!startRes.ok || !startRes.id) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-error">{startRes.error}</p>
      </div>
    );
  }

  return (
    <QuizTaker
      attemptId={startRes.id}
      quiz={quiz}
      questions={questions ?? []}
    />
  );
}
