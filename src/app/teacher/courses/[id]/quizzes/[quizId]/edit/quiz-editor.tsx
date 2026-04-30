"use client";

import { useState, useTransition } from "react";
import { Trash2, Plus } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { WidgetCard } from "@/components/shared/widget-card";
import { updateQuiz, deleteQuiz, addQuestion, deleteQuestion, type QuestionType } from "@/lib/actions/quizzes";

interface Question {
  id: string;
  question_ar: string;
  question_en: string | null;
  question_type: string;
  options: { id: string; text_ar: string }[] | null;
  correct_answer: { mcq?: string; fill_in?: string[]; true_false?: boolean };
  points: number;
  sort_order: number;
}

interface Quiz {
  id: string;
  title_ar: string;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  time_limit_minutes: number | null;
  passing_score_pct: number;
  available_at: string | null;
  due_at: string | null;
  is_published: boolean;
  course_id: string;
}

interface Props {
  quiz: Quiz;
  questions: Question[];
  courseId: string;
}

export function QuizEditor({ quiz, questions, courseId }: Props) {
  const { t } = useLang();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [questionType, setQuestionType] = useState<QuestionType>("mcq");

  const handleQuizSave = (fd: FormData) => {
    startTransition(async () => {
      const res = await updateQuiz(quiz.id, fd);
      if (res.ok) toast.success(t("تم الحفظ", "Saved"));
      else toast.error(res.error ?? t("فشل", "Failed"));
    });
  };

  const handleQuizDelete = () => {
    if (!confirm(t("حذف الاختبار نهائيًا؟", "Delete quiz permanently?"))) return;
    startTransition(async () => {
      const res = await deleteQuiz(quiz.id);
      if (res.ok) {
        toast.success(t("تم الحذف", "Deleted"));
        window.location.href = `/teacher/courses/${courseId}/quizzes`;
      } else {
        toast.error(res.error ?? t("فشل", "Failed"));
      }
    });
  };

  const handleAddQuestion = (fd: FormData) => {
    fd.set("question_type", questionType);
    startTransition(async () => {
      const res = await addQuestion(quiz.id, fd);
      if (res.ok) toast.success(t("تمت الإضافة", "Question added"));
      else toast.error(res.error ?? t("فشل", "Failed"));
    });
  };

  const handleDeleteQuestion = (qid: string) => {
    startTransition(async () => {
      const res = await deleteQuestion(qid);
      if (res.ok) toast.success(t("تم الحذف", "Deleted"));
      else toast.error(res.error ?? t("فشل", "Failed"));
    });
  };

  return (
    <div className="space-y-6">
      <WidgetCard title={t("إعدادات الاختبار", "Quiz Settings")}>
        <form action={handleQuizSave} className="space-y-3">
          <input required name="title_ar" defaultValue={quiz.title_ar} placeholder={t("العنوان بالعربية *", "Title (Arabic) *")} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
          <input name="title_en" defaultValue={quiz.title_en ?? ""} placeholder={t("Title (English)", "Title (English)")} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
          <textarea name="description_ar" defaultValue={quiz.description_ar ?? ""} rows={2} placeholder={t("الوصف", "Description")} className="glass-input w-full rounded-lg px-3 py-2 text-sm" />
          <div className="grid gap-3 sm:grid-cols-3">
            <input type="number" name="time_limit_minutes" defaultValue={quiz.time_limit_minutes ?? ""} placeholder={t("الحد الزمني (دقيقة)", "Time limit (min)")} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
            <input type="number" name="passing_score_pct" defaultValue={quiz.passing_score_pct} min={0} max={100} placeholder={t("نسبة النجاح", "Pass %")} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
            <input type="datetime-local" name="due_at" defaultValue={quiz.due_at ? quiz.due_at.slice(0, 16) : ""} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" name="is_published" defaultChecked={quiz.is_published} className="h-4 w-4 cursor-pointer accent-[var(--gold)]" />
            {t("منشور", "Published")}
          </label>
          <div className="flex items-center justify-between border-t border-[var(--surface-divider,#F0F0F2)] pt-3">
            <button type="button" onClick={handleQuizDelete} disabled={pending} className="inline-flex items-center gap-1.5 text-sm text-error hover:opacity-80 disabled:opacity-50">
              <Trash2 size={14} aria-hidden="true" /> {t("حذف الاختبار", "Delete quiz")}
            </button>
            <button type="submit" disabled={pending} className="glass-gold glass-pill px-6 py-2 text-sm font-semibold disabled:opacity-50">
              {pending ? "..." : t("حفظ", "Save")}
            </button>
          </div>
        </form>
      </WidgetCard>

      <WidgetCard title={`${t("الأسئلة", "Questions")} (${questions.length})`}>
        {questions.length === 0 ? (
          <p className="py-3 text-xs text-muted">{t("لا أسئلة بعد", "No questions yet")}</p>
        ) : (
          <ol className="space-y-2">
            {questions.map((q, i) => (
              <li key={q.id} className="rounded-lg border border-[var(--surface-divider,#F0F0F2)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-xs text-muted-light">
                      Q{i + 1} · {q.question_type.toUpperCase()} · {q.points} {t("نقاط", "pts")}
                    </p>
                    <p className="mt-1 text-sm">{q.question_ar}</p>
                    {q.options && (
                      <ul className="mt-2 space-y-0.5 text-xs text-muted">
                        {q.options.map((o) => (
                          <li key={o.id} className={o.id === q.correct_answer.mcq ? "font-semibold text-success" : ""}>
                            {o.id === q.correct_answer.mcq ? "✓ " : "• "}{o.text_ar}
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.question_type === "fill_in" && q.correct_answer.fill_in && (
                      <p className="mt-1 text-xs text-success">
                        ✓ {q.correct_answer.fill_in.join(" / ")}
                      </p>
                    )}
                    {q.question_type === "true_false" && (
                      <p className="mt-1 text-xs text-success">
                        ✓ {q.correct_answer.true_false ? t("صحيح", "True") : t("خطأ", "False")}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteQuestion(q.id)}
                    disabled={pending}
                    aria-label={t("حذف", "Delete")}
                    className="text-muted-light hover:text-error disabled:opacity-50"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </WidgetCard>

      <WidgetCard title={t("إضافة سؤال", "Add Question")}>
        <form action={handleAddQuestion} className="space-y-3">
          <div className="flex gap-2">
            {(["mcq", "fill_in", "true_false"] as QuestionType[]).map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setQuestionType(tp)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  questionType === tp ? "border-gold bg-gold/10 text-gold" : "border-[var(--surface-border)] text-muted hover:text-foreground"
                }`}
              >
                {tp === "mcq" ? t("اختيار من متعدد", "Multiple choice") : tp === "fill_in" ? t("إملاء", "Fill in") : t("صح/خطأ", "True/False")}
              </button>
            ))}
          </div>

          <input required name="question_ar" placeholder={t("نص السؤال بالعربية *", "Question (Arabic) *")} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
          <input name="question_en" placeholder={t("Question (English)", "Question (English)")} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />

          {questionType === "mcq" && (
            <>
              <textarea name="options" required rows={4} placeholder={t("خيار واحد في كل سطر", "One option per line")} className="glass-input w-full rounded-lg px-3 py-2 text-sm" />
              <input type="number" name="correct_index" required min={0} placeholder={t("رقم الخيار الصحيح (يبدأ من 0)", "Correct option index (0-based)")} className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
            </>
          )}

          {questionType === "fill_in" && (
            <input
              required
              name="acceptable_answers"
              placeholder={t("إجابات مقبولة، مفصولة بفواصل", "Acceptable answers (comma-separated)")}
              className="glass-input h-10 w-full rounded-lg px-3 text-sm"
            />
          )}

          {questionType === "true_false" && (
            <select name="tf_correct" required className="glass-input h-10 w-full rounded-lg px-2 text-sm">
              <option value="true">{t("الإجابة الصحيحة: صحيح", "Correct: True")}</option>
              <option value="false">{t("الإجابة الصحيحة: خطأ", "Correct: False")}</option>
            </select>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <input type="number" name="points" defaultValue={1} min={0} placeholder="Points" className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
            <input type="number" name="sort_order" defaultValue={questions.length} placeholder="Sort order" className="glass-input h-10 w-full rounded-lg px-3 text-sm" />
          </div>

          <button type="submit" disabled={pending} className="glass-pill inline-flex items-center gap-2 border border-[var(--surface-border)] px-4 py-2 text-sm font-medium hover:bg-foreground/5 disabled:opacity-50">
            <Plus size={14} aria-hidden="true" /> {t("إضافة", "Add")}
          </button>
        </form>
      </WidgetCard>
    </div>
  );
}
