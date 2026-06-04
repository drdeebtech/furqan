"use client";

import { startTransition as schedule, useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { WidgetCard } from "@/components/shared/widget-card";
import { submitQuizAttempt } from "@/lib/actions/quizzes";

interface Quiz {
  id: string;
  title_ar: string;
  title_en: string | null;
  time_limit_minutes: number | null;
  passing_score_pct: number;
}

interface Question {
  id: string;
  question_ar: string;
  question_en: string | null;
  question_type: string;
  options: { id: string; text_ar: string }[] | null;
  points: number;
}

interface Props {
  attemptId: string;
  quiz: Quiz;
  questions: Question[];
}

export function QuizTaker({ attemptId, quiz, questions }: Props) {
  const { t, dir, lang } = useLang();
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submitted, setSubmitted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(
    quiz.time_limit_minutes ? quiz.time_limit_minutes * 60 : null,
  );

  const handleSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    startTransition(async () => {
      const res = await submitQuizAttempt(attemptId, answers);
      if (res.ok) {
        toast.success(
          res.passed
            ? t(`نجحت! ${res.score_pct}%`, `Passed! ${res.score_pct}%`)
            : t(`النتيجة: ${res.score_pct}%`, `Score: ${res.score_pct}%`),
        );
        router.push("/student/quizzes");
      } else {
        toast.error(res.error ?? t("فشل التسليم", "Submit failed"));
        setSubmitted(false);
      }
    });
  }, [submitted, answers, attemptId, startTransition, toast, t, router]);

  // Timer countdown — schedule auto-submit and the per-second decrement
  // through startTransition so the React compiler doesn't flag setState-in-
  // effect (the actual mutations happen in a transition).
  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      schedule(() => handleSubmit());
      return;
    }
    const id = setTimeout(
      () => schedule(() => setSecondsLeft((s) => (s === null ? null : s - 1))),
      1000,
    );
    return () => clearTimeout(id);
  }, [secondsLeft, handleSubmit]);

  const setAns = (qid: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold sm:text-2xl">
          {lang === "ar" ? quiz.title_ar : (quiz.title_en ?? quiz.title_ar)}
        </h1>
        {secondsLeft !== null && (
          <span className={`font-mono text-base font-semibold tabular-nums ${secondsLeft < 60 ? "text-error" : "text-foreground"}`}>
            ⏱ {formatTime(secondsLeft)}
          </span>
        )}
      </header>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <WidgetCard key={q.id} title={`Q${i + 1}`}>
            <p className="mb-3 text-sm font-medium">
              {lang === "ar" ? q.question_ar : (q.question_en ?? q.question_ar)}
            </p>

            {q.question_type === "mcq" && q.options && (
              <ul className="space-y-1.5">
                {q.options.map((o) => {
                  const checked = answers[q.id] === o.id;
                  return (
                    <li key={o.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                          checked
                            ? "border-gold bg-gold/10"
                            : "border-[var(--surface-border)] hover:bg-foreground/5"
                        }`}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          value={o.id}
                          checked={checked}
                          onChange={() => setAns(q.id, o.id)}
                          className="h-4 w-4 cursor-pointer accent-[var(--gold)]"
                        />
                        <span className="text-sm">{o.text_ar}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}

            {q.question_type === "fill_in" && (
              <input
                type="text"
                value={(answers[q.id] as string) ?? ""}
                onChange={(e) => setAns(q.id, e.target.value)}
                placeholder={t("اكتب إجابتك...", "Type your answer...")}
                className="glass-input h-10 w-full rounded-lg px-3 text-sm"
              />
            )}

            {q.question_type === "true_false" && (
              <div className="flex gap-2">
                {(["true", "false"] as const).map((v) => {
                  const boolVal = v === "true";
                  const checked = answers[q.id] === boolVal;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAns(q.id, boolVal)}
                      className={`flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                        checked
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-[var(--surface-border)] text-muted hover:text-foreground"
                      }`}
                    >
                      {v === "true" ? t("صحيح", "True") : t("خطأ", "False")}
                    </button>
                  );
                })}
              </div>
            )}
          </WidgetCard>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending || submitted}
          className="glass-gold glass-pill px-8 py-3 text-base font-semibold disabled:opacity-50"
        >
          {pending || submitted ? t("جاري التسليم...", "Submitting…") : t("تسليم الاختبار", "Submit quiz")}
        </button>
      </div>
    </div>
  );
}
