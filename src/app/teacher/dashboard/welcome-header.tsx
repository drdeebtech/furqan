"use client";

import { Star, Users } from "lucide-react";
import { useLang } from "@/lib/i18n/context";

interface TeacherWelcomeHeaderProps {
  firstName: string | null;
  weekday: string;
  todaySessionCount: number;
  uniqueStudents: number;
  ratingAvg: number;
  cvStatus: "draft" | "pending_review" | "approved" | "rejected";
}

/**
 * Teacher's narrative-first welcome row. Surfaces:
 *   - Personalized greeting + weekday
 *   - Today's load (X sessions today)
 *   - Quick stats chips (students, rating)
 *   - CV-status pill when not yet approved (drives the next step)
 *
 * Uses semantic <header> + aria-live=polite so screen readers pick up
 * load changes when the data refreshes.
 */
export function TeacherWelcomeHeader({
  firstName, weekday, todaySessionCount, uniqueStudents, ratingAvg, cvStatus,
}: TeacherWelcomeHeaderProps) {
  const { t } = useLang();
  const cvNotApproved = cvStatus !== "approved";

  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold sm:text-3xl">
            {firstName
              ? t(`أهلاً، أستاذ ${firstName}`, `Welcome, Teacher ${firstName}`)
              : t("أهلاً بعودتك", "Welcome back")}
          </h1>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {weekday}
            {todaySessionCount > 0 ? (
              <>
                <span className="mx-2 text-muted-light" aria-hidden="true">·</span>
                <span className="text-foreground/80">
                  {t(
                    `${todaySessionCount} ${todaySessionCount === 1 ? "جلسة" : "جلسات"} اليوم`,
                    `${todaySessionCount} session${todaySessionCount === 1 ? "" : "s"} today`,
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="mx-2 text-muted-light" aria-hidden="true">·</span>
                <span>{t("لا جلسات اليوم", "No sessions today")}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {uniqueStudents > 0 && (
            <Chip icon={<Users size={12} aria-hidden="true" />}
              label={t(`${uniqueStudents} طالب`, `${uniqueStudents} students`)} />
          )}
          {ratingAvg > 0 && (
            <Chip
              icon={<Star size={12} aria-hidden="true" className="fill-current" />}
              label={ratingAvg.toFixed(1)}
              tone="gold"
            />
          )}
          {cvNotApproved && <CvStatusPill status={cvStatus} />}
        </div>
      </div>
    </header>
  );
}

function Chip({ icon, label, tone = "muted" }: { icon: React.ReactNode; label: string; tone?: "muted" | "gold" }) {
  const cls = tone === "gold"
    ? "border-gold/30 bg-gold/10 text-gold"
    : "border-[var(--surface-border)] bg-surface/40 text-foreground";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${cls}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

function CvStatusPill({ status }: { status: "draft" | "pending_review" | "rejected" | "approved" }) {
  const { t } = useLang();
  const map = {
    draft: { ar: "السيرة الذاتية: مسودة", en: "CV: Draft", tone: "warning" as const },
    pending_review: { ar: "السيرة الذاتية: قيد المراجعة", en: "CV: Under review", tone: "info" as const },
    rejected: { ar: "السيرة الذاتية: مرفوضة", en: "CV: Needs revision", tone: "error" as const },
    approved: { ar: "السيرة الذاتية: معتمدة", en: "CV: Approved", tone: "success" as const },
  };
  const meta = map[status];
  const tone = meta.tone === "warning"
    ? "border-warning/30 bg-warning/10 text-warning"
    : meta.tone === "info"
      ? "border-gold/30 bg-gold/10 text-gold"
      : meta.tone === "error"
        ? "border-error/30 bg-error/10 text-error"
        : "border-success/30 bg-success/10 text-success";
  return (
    <a
      href="/teacher/cv"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:opacity-90 ${tone}`}
    >
      <span>{t(meta.ar, meta.en)}</span>
    </a>
  );
}
