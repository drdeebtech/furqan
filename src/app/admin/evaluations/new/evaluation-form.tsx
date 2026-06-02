"use client";

import { useActionState } from "react";
import { createEvaluation } from "@/lib/actions/evaluations";
import { ActionFeedback } from "@/components/shared/action-feedback";

type State = { error?: string; success?: boolean } | null;

interface Props {
  students: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
}

const input =
  "w-full rounded-xl glass-input px-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none";
const select =
  "w-full rounded-xl glass-input px-4 py-3 text-sm text-foreground focus:border-gold focus:outline-none";
const textarea =
  "w-full rounded-xl glass-input px-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none min-h-[80px] resize-y";

const EVAL_TYPES = [
  { value: "weekly", label: "أسبوعي" },
  { value: "biweekly", label: "نصف شهري" },
  { value: "monthly", label: "شهري" },
  { value: "quarterly", label: "ربع سنوي" },
];

async function wrappedAction(_prev: State, formData: FormData): Promise<State> {
  const result = await createEvaluation(formData);
  if ("error" in result) return { error: result.error };
  return { success: true };
}

export function EvaluationForm({ students, teachers }: Props) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    wrappedAction,
    null,
  );

  if (state?.success) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/10 p-6 text-center">
        <p className="text-lg font-semibold text-success">تم إنشاء التقييم بنجاح</p>
        <a
          href="/admin/evaluations"
          className="mt-3 inline-block glass-gold glass-pill px-6 py-2 text-sm font-semibold transition-colors"
        >
          العودة للتقييمات
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <ActionFeedback state={state} />

      {/* Student & Teacher */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">الطالب *</label>
          <select name="student_id" required className={select}>
            <option value="">اختر الطالب</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">المعلم *</label>
          <select name="teacher_id" required className={select}>
            <option value="">اختر المعلم</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Type & Period */}
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium">نوع التقييم *</label>
          <select name="evaluation_type" required className={select}>
            <option value="">اختر النوع</option>
            {EVAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">تاريخ التقييم *</label>
          <input type="date" name="evaluation_date" required className={input} />
        </div>
      </div>

      {/* Scores */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gold">الدرجات (1-10)</h3>
        <div className="grid gap-4 md:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">الحفظ</label>
            <input type="number" name="hifz_score" min={1} max={10} className={input} placeholder="—" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">التجويد</label>
            <input type="number" name="tajweed_score" min={1} max={10} className={input} placeholder="—" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">الطلاقة</label>
            <input type="number" name="fluency_score" min={1} max={10} className={input} placeholder="—" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">الحضور</label>
            <input type="number" name="attendance_score" min={1} max={10} className={input} placeholder="—" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">الدرجة الكلية</label>
            <input type="number" name="overall_score" min={1} max={10} className={input} placeholder="—" />
          </div>
        </div>
      </div>

      {/* Text fields */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">نقاط القوة</label>
          <textarea name="strengths" className={textarea} placeholder="أبرز نقاط القوة لدى الطالب..." />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">للتحسين</label>
          <textarea name="areas_for_improvement" className={textarea} placeholder="النقاط التي تحتاج تحسين..." />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">الأهداف التالية</label>
          <textarea name="next_goals" className={textarea} placeholder="توصيات للطالب أو ولي الأمر..." />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">ملاحظات المعلم</label>
          <textarea name="teacher_comments" className={textarea} placeholder="ملاحظات إضافية..." />
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={pending}
        className="w-full glass-gold glass-pill px-6 py-3 text-sm font-semibold transition-colors disabled:opacity-50"
      >
        {pending ? "جارٍ الحفظ..." : "حفظ التقييم"}
      </button>
    </form>
  );
}
