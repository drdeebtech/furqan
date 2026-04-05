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
    <div className="rounded-2xl border border-card-border bg-card p-6">
      {"error" in state && state.error && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{state.error}</div>
      )}

      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">الطالب <span className="text-xs text-muted">Student</span></label>
            <select name="student_id" required className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none">
              <option value="">اختر الطالب</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">المعلم <span className="text-xs text-muted">Teacher</span></label>
            <select name="teacher_id" required className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none">
              <option value="">اختر المعلم</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">نوع التقييم</label>
            <select name="evaluation_type" required className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none">
              <option value="weekly">أسبوعي</option>
              <option value="biweekly">نصف شهري</option>
              <option value="monthly">شهري</option>
              <option value="quarterly">ربع سنوي</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">بداية الفترة</label>
            <input name="period_start" type="date" required className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">نهاية الفترة</label>
            <input name="period_end" type="date" required className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-5">
          {[
            { name: "hifz_score", label: "الحفظ" },
            { name: "tajweed_score", label: "التجويد" },
            { name: "akhlaq_score", label: "الأخلاق" },
            { name: "attendance_score", label: "الحضور" },
            { name: "overall_score", label: "الإجمالي" },
          ].map(f => (
            <div key={f.name}>
              <label className="mb-1 block text-sm font-medium">{f.label} <span className="text-xs text-muted">/10</span></label>
              <input name={f.name} type="number" min={1} max={10} className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none" />
            </div>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">نقاط القوة</label>
          <textarea name="strengths" rows={2} className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">نقاط الضعف</label>
          <textarea name="weaknesses" rows={2} className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">التوصيات</label>
          <textarea name="recommendations" rows={2} className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">ملاحظات إضافية</label>
          <textarea name="notes" rows={2} className="w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none" />
        </div>

        <button type="submit" disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 font-semibold text-white neu-btn transition-colors hover:bg-primary-hover disabled:opacity-50">
          {pending ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : "حفظ التقييم"}
        </button>
      </form>
    </div>
  );
}
