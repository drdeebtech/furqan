import { Mail, Clock } from "lucide-react";
import { getT } from "@/lib/i18n/server";

/**
 * Parent-report digest card — surfaces the parent-communication leg
 * of the teaching loop on the teacher dashboard.
 *
 * Shows: count of parent_reports created in the last 7 days for this
 * teacher's students, breakdown by report type, and the 3 most-recent
 * with student name + relative time. A footnote explains the
 * delivery-status caveat (sent_at stays null until email/SMS is wired).
 *
 * Server-rendered to match the other bottom-section cards.
 */

const TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  session_summary: { ar: "ملخص جلسة", en: "Session summary" },
  evaluation: { ar: "تقييم", en: "Evaluation" },
  no_show: { ar: "غياب", en: "No-show" },
  homework_not_done: { ar: "متابعة لم تُنجز", en: "Follow-up not done" },
};

function relativeTime(iso: string, lang: "ar" | "en"): string {
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

export async function ParentReportDigestCard({
  data,
}: {
  data: {
    totalCount: number;
    byType: { type: string; count: number }[];
    recent: Array<{ id: string; title: string; reportType: string; studentName: string; createdAt: string; sent: boolean }>;
  };
}) {
  const { t, lang } = await getT();
  const langKey: "ar" | "en" = lang === "ar" ? "ar" : "en";

  if (data.totalCount === 0) {
    return (
      <section
        aria-label={t("تقارير أولياء الأمور", "Parent reports")}
        className="mt-4 glass-card p-4 sm:p-5"
      >
        <div className="flex items-center gap-3">
          <Mail size={18} className="text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              {t("تقارير أولياء الأمور (7 أيام)", "Parent reports (last 7 days)")}
            </p>
            <p className="text-sm text-muted">
              {t(
                "لم يُرسَل تقرير لأولياء الأمور هذا الأسبوع. التقارير تُنشأ تلقائياً عند حفظ الملاحظات أو تسجيل تقييم أو غياب.",
                "No parent reports created this week. Reports auto-generate when you save session notes, log an evaluation, or mark a no-show.",
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={t("تقارير أولياء الأمور", "Parent reports")}
      className="mt-4 glass-card p-4 sm:p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <Mail size={18} className="text-gold" aria-hidden="true" />
        <h3 className="font-display text-sm font-semibold">
          {t(
            `تقارير أولياء الأمور — ${data.totalCount} هذا الأسبوع`,
            `Parent reports — ${data.totalCount} this week`,
          )}
        </h3>
      </div>

      {data.byType.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {data.byType.map(({ type, count }) => {
            const label = TYPE_LABELS[type]
              ? (langKey === "ar" ? TYPE_LABELS[type].ar : TYPE_LABELS[type].en)
              : type;
            return (
              <span
                key={type}
                className="inline-flex items-center gap-1 rounded-full border border-card-border bg-foreground/5 px-2 py-0.5 text-[11px] text-muted"
              >
                {label} <span className="font-mono">{count}</span>
              </span>
            );
          })}
        </div>
      )}

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
            <span className="inline-flex shrink-0 items-center gap-1 text-muted" aria-label={t("منذ متى", "How long ago")}>
              <Clock size={11} aria-hidden="true" />
              {relativeTime(row.createdAt, langKey)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] text-muted">
        {t(
          "يُسجَّل التاريخ الزمني للإنشاء فقط. حالة التسليم (تم إرسالها بالبريد/الهاتف) ستظهر هنا بعد ربط مزود الإرسال.",
          "Tracks creation timestamps only. Delivery status (email/SMS sent) will appear here once the messaging provider is wired.",
        )}
      </p>
    </section>
  );
}
