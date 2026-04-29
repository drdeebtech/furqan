"use client";

import { useState, useTransition } from "react";
import { Check, ListChecks, X, Edit3 } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { WidgetCard } from "@/components/shared/widget-card";
import {
  setLessonPlan,
  toggleCheckpoint,
  clearLessonPlan,
  type LessonPlan,
} from "@/lib/actions/session-lesson-plan";

interface Props {
  sessionId: string;
  initialPlan: LessonPlan | null;
}

export function LessonPlanPanel({ sessionId, initialPlan }: Props) {
  const { t, dir } = useLang();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(!initialPlan);
  const [draft, setDraft] = useState(
    initialPlan?.checkpoints.map((c) => c.label).join("\n") ?? "",
  );
  const [plan, setPlan] = useState<LessonPlan | null>(initialPlan);

  const total = plan?.checkpoints.length ?? 0;
  const done = plan?.checkpoints.filter((c) => c.completed_at).length ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const handleSavePlan = () => {
    const labels = draft.split("\n").map((l) => l.trim()).filter(Boolean);
    if (labels.length === 0) {
      toast.error(t("أدخل على الأقل نقطة واحدة", "Add at least one checkpoint"));
      return;
    }
    startTransition(async () => {
      const res = await setLessonPlan(sessionId, labels);
      if (res.ok) {
        toast.success(t("تم حفظ الخطة", "Plan saved"));
        // Optimistic local update; the server-rendered value updates on
        // next refresh.
        setPlan({
          checkpoints: labels.map((label, i) => ({
            id: `local-${i}-${Date.now()}`,
            label,
            completed_at: null,
          })),
          last_updated_at: new Date().toISOString(),
        });
        setEditing(false);
      } else {
        toast.error(res.error ?? t("فشل الحفظ", "Save failed"));
      }
    });
  };

  const handleToggle = (id: string, completed: boolean) => {
    if (!plan) return;
    // Optimistic UI
    setPlan({
      ...plan,
      checkpoints: plan.checkpoints.map((c) =>
        c.id === id ? { ...c, completed_at: completed ? new Date().toISOString() : null } : c,
      ),
    });
    startTransition(async () => {
      const res = await toggleCheckpoint(sessionId, id, completed);
      if (!res.ok) {
        // Roll back on error
        setPlan(plan);
        toast.error(res.error ?? t("فشل التحديث", "Update failed"));
      }
    });
  };

  const handleClear = () => {
    if (!confirm(t("حذف الخطة؟", "Clear plan?"))) return;
    startTransition(async () => {
      const res = await clearLessonPlan(sessionId);
      if (res.ok) {
        setPlan(null);
        setDraft("");
        setEditing(true);
        toast.success(t("تم المسح", "Cleared"));
      } else {
        toast.error(res.error ?? t("فشل", "Failed"));
      }
    });
  };

  return (
    <WidgetCard
      title={t("خطة الدرس", "Lesson Plan")}
      headerAction={
        plan && !editing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(plan.checkpoints.map((c) => c.label).join("\n"));
              setEditing(true);
            }}
            aria-label={t("تعديل", "Edit")}
            className="text-muted-light transition-colors hover:text-foreground"
          >
            <Edit3 size={14} aria-hidden="true" />
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="space-y-3" dir={dir}>
          <p className="text-xs text-muted">
            {t("نقطة واحدة في كل سطر — رتبها كما ستسير في الدرس.",
               "One checkpoint per line — order them as you'll cover them in class.")}
          </p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            className="glass-input w-full rounded-lg px-3 py-2 text-sm leading-relaxed"
            placeholder={t(
              "مراجعة الآيات السابقة\nتسميع الآيات الجديدة\nتجويد المد والإدغام",
              "Review previous ayahs\nRecite new memorization\nTajweed of madd and idgham",
            )}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSavePlan}
              disabled={pending}
              className="glass-gold glass-pill inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              <ListChecks size={14} aria-hidden="true" />
              {plan ? t("تحديث الخطة", "Update plan") : t("ابدأ الخطة", "Start plan")}
            </button>
            {plan && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={pending}
                className="glass-pill border border-[var(--surface-border)] px-3 py-2 text-sm text-muted hover:text-foreground"
              >
                {t("إلغاء", "Cancel")}
              </button>
            )}
          </div>
        </div>
      ) : plan ? (
        <div className="space-y-3" dir={dir}>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">
              {done} / {total} {t("مكتمل", "complete")}
            </span>
            <span className="font-mono font-semibold text-gold">⚡ {pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-divider,#E5E7EB)]">
            <div
              className="h-full rounded-full bg-[var(--data-progress,#3B82F6)] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <ul className="space-y-1.5">
            {plan.checkpoints.map((c) => {
              const isDone = !!c.completed_at;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => handleToggle(c.id, !isDone)}
                    disabled={pending}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm transition-colors ${
                      isDone
                        ? "text-muted line-through hover:bg-foreground/5"
                        : "text-foreground hover:bg-foreground/5"
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px] ${
                        isDone
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-[var(--surface-border)]"
                      }`}
                    >
                      {isDone && <Check size={12} aria-hidden="true" />}
                    </span>
                    <span className="flex-1">{c.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={handleClear}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-xs text-muted-light transition-colors hover:text-error disabled:opacity-50"
          >
            <X size={12} aria-hidden="true" /> {t("مسح الخطة", "Clear plan")}
          </button>
        </div>
      ) : null}
    </WidgetCard>
  );
}
