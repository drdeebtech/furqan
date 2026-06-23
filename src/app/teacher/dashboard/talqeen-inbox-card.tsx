import Link from "next/link";
import { Mic, ArrowRight, Clock } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { helperOrFail } from "@/lib/supabase/load-or-fail";
import { getTeacherTalqeenInbox } from "@/lib/views/teacher-inbox";
import { createClient } from "@/lib/supabase/server";
import { Skeleton } from "@/components/shared/skeleton";

/**
 * Sprint Improvement #2 (2026-05-05) — Talqeen Audio Inbox card.
 *
 * Surfaces the count + 5 most-recent recitation-type follow-ups
 * awaiting grading. Talqeen audio submissions are the single
 * pedagogically distinctive primitive on FURQAN — without a dedicated
 * surface they merge into the generic grading queue and lose
 * priority.
 *
 * Server-rendered (matches RosterErrorPulse + DataLoadBanner pattern).
 * Links to /teacher/follow-up where the teacher grades inline using
 * HomeworkAudioPlayer; no per-row deep-link to keep the click path
 * familiar.
 */

function formatDuration(seconds: number | null, lang: "ar" | "en"): string {
  if (seconds == null || seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (lang === "ar") {
    if (mins === 0) return `${secs} ث`;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }
  if (mins === 0) return `${secs}s`;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function relativeTime(iso: string | null, lang: "ar" | "en"): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (lang === "ar") {
    if (diffMins < 60) return `قبل ${diffMins} د`;
    if (diffHours < 24) return `قبل ${diffHours} س`;
    return `قبل ${diffDays} يوم`;
  }
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export async function TalqeenInboxCard({ teacherId }: { teacherId: string }) {
  // Self-fetching so the parent page can wrap us in <Suspense> and
  // unblock first-paint while this query runs (Stream 1B perf refactor).
  const supabase = await createClient();
  const { data } = await helperOrFail(
    () => getTeacherTalqeenInbox(supabase, teacherId),
    { totalCount: 0, recent: [] },
    { route: "teacher-dashboard", widget: "talqeen-inbox" },
  );

  const { t, lang } = await getT();
  const langKey: "ar" | "en" = lang === "ar" ? "ar" : "en";

  // Empty state — different copy than the actively-pending state.
  if (data.totalCount === 0) {
    return (
      <section
        aria-label={t("صندوق التلقين", "Talqeen inbox")}
        className="mt-4 glass-card p-4 sm:p-5"
      >
        <div className="flex items-center gap-3">
          <Mic size={18} className="text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              {t("صندوق التلقين", "Talqeen inbox")}
            </p>
            <p className="text-sm text-muted">
              {t(
                "لا توجد تسجيلات تلاوة بانتظار التصحيح حالياً.",
                "No recitation recordings awaiting your correction right now.",
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Active state — count + the 5 most-recent rows + CTA.
  return (
    <section
      aria-label={t("صندوق التلقين", "Talqeen inbox")}
      className="mt-4 glass-card border-gold/20 p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mic size={18} className="text-gold" aria-hidden="true" />
          <h3 className="font-display text-sm font-semibold">
            {t(
              `صندوق التلقين — ${data.totalCount} بانتظار التصحيح`,
              `Talqeen inbox — ${data.totalCount} awaiting correction`,
            )}
          </h3>
        </div>
        <Link
          href="/teacher/talqeen"
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-gold px-3 py-1.5 text-xs font-medium text-background hover:bg-gold-hover focus-ring"
        >
          {t("ابدأ التصحيح", "Start corrections")}
          <ArrowRight size={12} aria-hidden="true" className={lang === "ar" ? "rotate-180" : ""} />
        </Link>
      </div>

      <ul className="space-y-2">
        {data.recent.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card/30 p-2.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{row.studentName}</p>
              <p className="truncate text-muted">{row.title}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-muted">
              <span className="inline-flex items-center gap-1" aria-label={t("مدة التسجيل", "Audio duration")}>
                <Mic size={11} aria-hidden="true" />
                {formatDuration(row.audioDurationSeconds, langKey)}
              </span>
              <span className="inline-flex items-center gap-1" aria-label={t("منذ متى", "How long ago")}>
                <Clock size={11} aria-hidden="true" />
                {relativeTime(row.readyAt, langKey)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {data.totalCount > data.recent.length && (
        <p className="mt-2 text-[11px] text-muted">
          {t(
            `+ ${data.totalCount - data.recent.length} تسجيل إضافي معروض داخل صفحة المتابعة.`,
            `+ ${data.totalCount - data.recent.length} more shown inside the follow-up page.`,
          )}
        </p>
      )}
    </section>
  );
}

/**
 * Suspense fallback. Pre-allocates roughly the height of the active
 * state so the layout doesn't shift when real content streams in.
 */
export function TalqeenInboxCardSkeleton() {
  return (
    <section className="mt-4 glass-card p-4 sm:p-5" aria-hidden="true">
      <Skeleton className="mb-3 h-5 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </section>
  );
}
