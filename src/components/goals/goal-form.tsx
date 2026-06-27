"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { setStudentGoal, setTeacherStudentGoal } from "@/lib/domains/goals/actions";
import { useLang } from "@/lib/i18n/context";

interface GoalFormValue {
  surah_start: number;
  ayah_start: number;
  surah_end: number;
  ayah_end: number;
  target_date: string;
}

interface GoalFormProps {
  initialGoal?: GoalFormValue | null;
  studentId?: string;
}

const inputClass = "w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none";

export function GoalForm({ initialGoal, studentId }: GoalFormProps) {
  const { t, dir } = useLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const input = {
      surahStart: Number(formData.get("surahStart")),
      ayahStart: Number(formData.get("ayahStart")),
      surahEnd: Number(formData.get("surahEnd")),
      ayahEnd: Number(formData.get("ayahEnd")),
      targetDate: String(formData.get("targetDate")),
    };

    startTransition(async () => {
      const saveOutcome = studentId
        ? await setTeacherStudentGoal({ ...input, studentId })
        : await setStudentGoal(input);
      setFeedback(saveOutcome.ok
        ? { error: false, text: saveOutcome.message ?? t("تم حفظ الهدف", "Goal saved") }
        : { error: true, text: saveOutcome.error });
      if (saveOutcome.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} dir={dir} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="space-y-1 text-xs text-muted">
          <span>{t("سورة البداية", "Start surah")}</span>
          <input className={inputClass} name="surahStart" type="number" min={1} max={114} required defaultValue={initialGoal?.surah_start ?? 1} />
        </label>
        <label className="space-y-1 text-xs text-muted">
          <span>{t("آية البداية", "Start ayah")}</span>
          <input className={inputClass} name="ayahStart" type="number" min={1} required defaultValue={initialGoal?.ayah_start ?? 1} />
        </label>
        <label className="space-y-1 text-xs text-muted">
          <span>{t("سورة النهاية", "End surah")}</span>
          <input className={inputClass} name="surahEnd" type="number" min={1} max={114} required defaultValue={initialGoal?.surah_end ?? 1} />
        </label>
        <label className="space-y-1 text-xs text-muted">
          <span>{t("آية النهاية", "End ayah")}</span>
          <input className={inputClass} name="ayahEnd" type="number" min={1} required defaultValue={initialGoal?.ayah_end ?? 7} />
        </label>
      </div>
      <label className="block space-y-1 text-xs text-muted">
        <span>{t("التاريخ المستهدف", "Target date")}</span>
        <input
          className={inputClass}
          name="targetDate"
          type="date"
          min={new Date().toISOString().slice(0, 10)}
          required
          defaultValue={initialGoal?.target_date ?? ""}
          dir="ltr"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-background hover:bg-gold-hover disabled:opacity-50">
          {pending ? t("جارٍ الحفظ…", "Saving…") : t("حفظ الهدف", "Save goal")}
        </button>
        {feedback && (
          <p role="status" className={`text-sm ${feedback.error ? "text-error" : "text-success"}`}>
            {feedback.text}
          </p>
        )}
      </div>
    </form>
  );
}
