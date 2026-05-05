"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { createEvaluation } from "@/lib/actions/evaluations";

interface Props {
  students: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
  redirectTo: string;
}

export function EvaluationForm({ students, teachers, redirectTo }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string } | { success: boolean }, formData: FormData) => {
      const result = await createEvaluation(formData);
      if (result.success) {
        router.push(redirectTo);
      }
      return result;
    },
    { success: false } as { error?: string } | { success: boolean },
  );

  return (
    <div className="glass-card p-6">
      {"error" in state && state.error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{state.error}</div>
      )}

      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="student_id" className="mb-1 block text-sm font-medium">الطالب <span className="text-xs text-muted">Student</span></label>
            <select id="student_id" name="student_id" required className="glass-input w-full rounded-xl px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none">
              <option value="">اختر الطالب</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="teacher_id" className="mb-1 block text-sm font-medium">المعلم <span className="text-xs text-muted">Teacher</span></label>
            <select id="teacher_id" name="teacher_id" required className="glass-input w-full rounded-xl px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none">
              <option value="">اختر المعلم</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="evaluation_type" className="mb-1 block text-sm font-medium">نوع التقييم</label>
            <select id="evaluation_type" name="evaluation_type" required className="glass-input w-full rounded-xl px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none">
              <option value="weekly">أسبوعي</option>
              <option value="biweekly">نصف شهري</option>
              <option value="monthly">شهري</option>
              <option value="quarterly">ربع سنوي</option>
            </select>
          </div>
          <div>
            <label htmlFor="evaluation_date" className="mb-1 block text-sm font-medium">تاريخ التقييم</label>
            <input id="evaluation_date" name="evaluation_date" type="date" required className="glass-input w-full rounded-xl px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-5">
          {[
            { name: "hifz_score", label: "الحفظ" },
            { name: "tajweed_score", label: "التجويد" },
            { name: "fluency_score", label: "الطلاقة" },
            { name: "attendance_score", label: "الحضور" },
            { name: "overall_score", label: "الإجمالي" },
          ].map(f => (
            <div key={f.name}>
              <label htmlFor={f.name} className="mb-1 block text-sm font-medium">{f.label} <span className="text-xs text-muted">/10</span></label>
              <input id={f.name} name={f.name} type="number" min={1} max={10} className="glass-input w-full rounded-xl px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none" />
            </div>
          ))}
        </div>

        <div>
          <label htmlFor="strengths" className="mb-1 block text-sm font-medium">نقاط القوة</label>
          <textarea id="strengths" name="strengths" rows={2} className="glass-input w-full rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none" />
        </div>
        <div>
          <label htmlFor="areas_for_improvement" className="mb-1 block text-sm font-medium">للتحسين</label>
          <textarea id="areas_for_improvement" name="areas_for_improvement" rows={2} className="glass-input w-full rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none" />
        </div>
        <div>
          <label htmlFor="next_goals" className="mb-1 block text-sm font-medium">الأهداف التالية</label>
          <textarea id="next_goals" name="next_goals" rows={2} className="glass-input w-full rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none" />
        </div>
        <div>
          <label htmlFor="teacher_comments" className="mb-1 block text-sm font-medium">ملاحظات المعلم</label>
          <textarea id="teacher_comments" name="teacher_comments" rows={2} className="glass-input w-full rounded-xl px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none" />
        </div>

        <button type="submit" disabled={pending}
          className="glass-gold glass-pill flex w-full items-center justify-center gap-2 py-2.5 font-semibold transition-colors disabled:opacity-50">
          {pending ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : "حفظ التقييم"}
        </button>
      </form>
    </div>
  );
}
