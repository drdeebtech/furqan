import Link from "next/link";
import { Activity, ArrowRight } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { helperOrFail } from "@/lib/supabase/load-or-fail";
import { getTeacherRosterErrorPulse, type RecitationErrorCategory } from "@/lib/dashboard-queries";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/shared/skeleton";

/**
 * Sprint Improvement #3 (2026-05-05) — roster-wide recitation-error pulse.
 *
 * Shows the top 3 tajweed/qira'a categories the teacher's whole roster
 * needs work on this month, so curriculum planning has a data anchor
 * (vs the per-student heatmap which is buried in /teacher/students/[id]).
 *
 * Server-rendered for the same reason DataLoadBanner is — i18n + tokens
 * are already server-side, no interactivity needed beyond the link.
 */
const CATEGORY_LABELS: Record<RecitationErrorCategory, { ar: string; en: string }> = {
  makharij: { ar: "مخارج الحروف", en: "Makharij" },
  sifat: { ar: "صفات الحروف", en: "Sifat" },
  madd: { ar: "المد", en: "Madd" },
  waqf: { ar: "الوقف", en: "Waqf" },
  ghunna: { ar: "الغُنّة", en: "Ghunna" },
  other: { ar: "أخرى", en: "Other" },
};

export async function RosterErrorPulse({ teacherId }: { teacherId: string }) {
  // Self-fetching for Suspense streaming (Stream 1B).
  const supabase = await createClient();
  const { data } = await helperOrFail(
    () => getTeacherRosterErrorPulse(supabase, teacherId),
    [] as { category: RecitationErrorCategory; count: number }[],
    { route: "teacher-dashboard", widget: "roster-error-pulse" },
  );

  const { t, lang } = await getT();

  if (data.length === 0) {
    return (
      <section
        aria-label={t("نبض أخطاء الفصل", "Roster error pulse")}
        className="mt-4 glass-card p-4 sm:p-5"
      >
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              {t("نبض أخطاء الفصل (30 يوماً)", "Roster error pulse (last 30 days)")}
            </p>
            <p className="text-sm text-muted">
              {t(
                "لا توجد أخطاء مُسجَّلة بعد لطلابك. ابدأ تسجيل الأخطاء أثناء الجلسات لظهور هذا التحليل.",
                "No errors logged for your students yet. Start logging errors during sessions to populate this analysis.",
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const max = Math.max(...data.map(d => d.count));

  return (
    <section
      aria-label={t("نبض أخطاء الفصل", "Roster error pulse")}
      className="mt-4 glass-card p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-gold" aria-hidden="true" />
          <h3 className="font-display text-sm font-semibold">
            {t("نبض أخطاء الفصل (30 يوماً)", "Roster error pulse (last 30 days)")}
          </h3>
        </div>
        <Link
          href="/teacher/students"
          className="inline-flex items-center gap-1 text-xs text-gold hover:text-gold-hover focus-ring rounded"
        >
          {t("التفاصيل لكل طالب", "Per-student detail")}
          <ArrowRight size={12} aria-hidden="true" className={lang === "ar" ? "rotate-180" : ""} />
        </Link>
      </div>

      <ul className="space-y-2.5">
        {data.map(({ category, count }) => {
          const widthPct = Math.max(8, Math.round((count / max) * 100));
          const label = lang === "ar" ? CATEGORY_LABELS[category].ar : CATEGORY_LABELS[category].en;
          return (
            <li key={category} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-3 text-xs">
              <span className="truncate font-medium">{label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-foreground/5">
                <div
                  className="h-full rounded-full bg-gold/70"
                  style={{ width: `${widthPct}%` }}
                  aria-hidden="true"
                />
              </div>
              <span className="text-end font-mono text-muted" aria-label={t(`${count} خطأ`, `${count} errors`)}>
                {count}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[11px] text-muted">
        {t(
          "ركّز خطة الأسبوع القادم على أعلى فئة. تُستثنى أعلام «بدون أخطاء» تلقائياً.",
          "Plan next week's curriculum around the top category. \"No errors observed\" attestations are excluded.",
        )}
      </p>
    </section>
  );
}

export function RosterErrorPulseSkeleton() {
  return (
    <section className="mt-4 glass-card p-4 sm:p-5" aria-hidden="true">
      <Skeleton className="mb-3 h-5 w-64" />
      <div className="space-y-2.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="grid grid-cols-[6rem_1fr_2rem] items-center gap-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3 w-6" />
          </div>
        ))}
      </div>
    </section>
  );
}
