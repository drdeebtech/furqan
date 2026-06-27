import { BookOpen, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { helperOrFail } from "@/lib/supabase/load-or-fail";
import {
  getTeacherMurajaahHealth,
  type StudentMurajaahHealth,
  type MurajaahEaseTrend,
} from "@/lib/views/teacher-insights";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/shared/skeleton";

/**
 * Per-student SM-2 murajaah health widget (issue #543).
 *
 * Self-fetching Server Component for Suspense streaming. Shows each of
 * the teacher's students: overdue-item count (red when >3 days), last
 * review date, and ease-factor trend direction.
 *
 * No N+1: a single join query aggregated app-side, plus one flat name
 * lookup (see getTeacherMurajaahHealth in teacher-insights.ts).
 */

const TREND_ICON: Record<MurajaahEaseTrend, typeof TrendingUp> = {
  improving: TrendingUp,
  stable: Minus,
  declining: TrendingDown,
};

const TREND_CLASS: Record<MurajaahEaseTrend, string> = {
  improving: "text-emerald-500",
  stable: "text-muted",
  declining: "text-amber-500",
};

function formatDate(iso: string | null, lang: string): string {
  if (!iso) return lang === "ar" ? "لم تُراجَع بعد" : "Never";
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

export async function MurajaahHealthCard({ teacherId }: { teacherId: string }) {
  const supabase = await createClient();
  const { data } = await helperOrFail(
    () => getTeacherMurajaahHealth(supabase, teacherId),
    [] as StudentMurajaahHealth[],
    { route: "teacher-dashboard", widget: "murajaah-health" },
  );

  const { t, lang } = await getT();

  const sectionLabel = t("مراجعة الطلاب", "Student Murajaah Health");

  if (data.length === 0) {
    return (
      <section aria-label={sectionLabel} className="mt-4 glass-card p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <BookOpen size={18} className="text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              {t("مراجعة الطلاب / مراجعة الطلاب", sectionLabel)}
            </p>
            <p className="text-sm text-muted">
              {t(
                "لا توجد جداول مراجعة بعد لطلابك.",
                "No review schedules found for your students yet.",
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={sectionLabel} className="mt-4 glass-card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <BookOpen size={18} className="text-gold" aria-hidden="true" />
        <h3 className="font-display text-sm font-semibold">
          {t("مراجعة الطلاب", "Student Murajaah Health")}
        </h3>
      </div>

      <ul className="divide-y divide-foreground/5" role="list">
        {data.map((s) => {
          const isOverdue = s.overdueCount > 0;
          const TrendIcon = TREND_ICON[s.easeTrend];
          const trendClass = TREND_CLASS[s.easeTrend];
          const trendLabel =
            s.easeTrend === "improving"
              ? t("تحسّن", "Improving")
              : s.easeTrend === "declining"
                ? t("تراجع", "Declining")
                : t("مستقر", "Stable");

          return (
            <li
              key={s.studentId}
              className={`flex items-center justify-between gap-3 py-2.5 text-xs ${
                isOverdue ? "text-red-500" : ""
              }`}
            >
              {/* Student name + overdue badge */}
              <span
                className={`min-w-0 flex-1 truncate font-medium ${
                  isOverdue ? "text-red-500" : ""
                }`}
              >
                {s.studentName}
                {isOverdue && (
                  <span
                    className="ms-1.5 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold bg-red-500/10 text-red-500"
                    aria-label={t(
                      `${s.overdueCount} عنصر متأخر`,
                      `${s.overdueCount} overdue`,
                    )}
                  >
                    {s.overdueCount}+
                  </span>
                )}
              </span>

              {/* Last reviewed date */}
              <span
                className={`shrink-0 tabular-nums ${isOverdue ? "text-red-400" : "text-muted"}`}
                aria-label={t("آخر مراجعة", "Last reviewed")}
              >
                {formatDate(s.lastReviewedAt, lang)}
              </span>

              {/* Ease trend icon */}
              <TrendIcon
                size={14}
                className={`shrink-0 ${trendClass}`}
                aria-label={trendLabel}
              />
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] text-muted">
        {t(
          "الصفوف الحمراء: تأخّر >٣ أيام. السهم: اتجاه معامل السهولة SM-2.",
          "Red rows: overdue >3 days. Arrow: SM-2 ease-factor trend direction.",
        )}
      </p>
    </section>
  );
}

export function MurajaahHealthCardSkeleton() {
  return (
    <section className="mt-4 glass-card p-4 sm:p-5" aria-hidden="true">
      <Skeleton className="mb-3 h-5 w-56" />
      <div className="divide-y divide-foreground/5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 py-2.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-3 rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}
