"use client";

import { GoalForm } from "@/components/goals/goal-form";
import { useLang } from "@/lib/i18n/context";
import type { StudentGoalRow } from "@/lib/domains/goals/goals";

export function GoalSection({ studentId, goal }: { studentId: string; goal: StudentGoalRow | null }) {
  const { t } = useLang();
  return (
    <section className="glass-card mb-6 p-6">
      <h2 className="mb-1 text-lg font-bold">{t("هدف الحفظ", "Memorization goal")}</h2>
      <p className="mb-4 text-sm text-muted">
        {t("حدّد نطاق الحفظ والتاريخ المستهدف لهذا الطالب.", "Set this student's memorization range and target date.")}
      </p>
      <GoalForm studentId={studentId} initialGoal={goal} />
    </section>
  );
}
