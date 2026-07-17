// Spec 040 FR-024 — the teacher earnings ledger (server-rendered, RTL-safe).
// Transparency is the requirement: every row shows its state, every deduction
// its cause, and any outstanding negative balance is surfaced — a deduction
// is never a silent surprise.

import type { Lang } from "@/lib/i18n/server";

export interface LedgerEntry {
  id: string;
  kind: string;
  amount_cents: number;
  status: string;
  hold_reason: string | null;
  session_delivery_id: string | null;
  recovered_against_entry_id: string | null;
  settled_at: string | null;
  created_at: string;
}

const KIND_COPY: Record<string, { ar: string; en: string }> = {
  session: { ar: "جلسة", en: "Session" },
  course: { ar: "دورة", en: "Course" },
  clawback: { ar: "استرداد من طالب", en: "Refund clawback" },
  debt_recovery: { ar: "خصم من الرصيد المستحق", en: "Debt deduction" },
  debt_recovery_reversal: { ar: "إلغاء خصم", en: "Deduction reversal" },
};

const STATUS_COPY: Record<string, { ar: string; en: string }> = {
  pending: { ar: "بانتظار التحويل", en: "Pending" },
  processing: { ar: "قيد التحويل", en: "Processing" },
  held: { ar: "مجمّد", en: "Held" },
  transferred: { ar: "حُوِّل", en: "Transferred" },
  voided: { ar: "أُلغي", en: "Voided" },
  debt_recovered: { ar: "خُصم من الرصيد", en: "Offset against balance" },
  manual_due: { ar: "بانتظار التسوية اليدوية", en: "Awaiting manual settlement" },
  manual_paid: { ar: "سُوّي يدويًا", en: "Manually settled" },
};

const HOLD_COPY: Record<string, { ar: string; en: string }> = {
  agreement_pending: {
    ar: "بانتظار الموافقة على الاتفاقية — يُفرج عنه فور موافقتك",
    en: "Awaiting agreement acceptance — released once you accept",
  },
  dispute: { ar: "نزاع مفتوح على الدفعة", en: "Open payment dispute" },
};

function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function EarningsTable({
  entries,
  outstandingDebtCents,
  lang,
}: {
  entries: LedgerEntry[];
  outstandingDebtCents: number;
  lang: Lang;
}) {
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  return (
    <section className="glass-card rounded-xl p-6" aria-labelledby="earnings-heading">
      <h2 id="earnings-heading" className="mb-3 text-lg font-bold">
        {t("سجل الأرباح", "Earnings ledger")}
      </h2>

      {outstandingDebtCents > 0 ? (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {t(
            `رصيد مستحق للمنصة قدره ${formatUsd(outstandingDebtCents)} (بسبب استردادات أو نزاعات) — يُخصم تلقائيًا من أرباحك القادمة قبل أي تحويل.`,
            `An outstanding balance of ${formatUsd(outstandingDebtCents)} (from refunds or disputes) is owed to the platform — it is offset automatically against your next earnings before any transfer.`,
          )}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-sm text-muted">
          {t(
            "لا توجد أرباح مسجَّلة بعد — تظهر الجلسات المكتملة هنا بعد تأكيد الحضور.",
            "No earnings recorded yet — completed sessions appear here after attendance is confirmed.",
          )}
        </p>
      ) : (
        <div
          // Keyboard-reachable horizontal scroll (CodeRabbit): arrow-key
          // scrolling for keyboard-only users, visible focus ring.
          tabIndex={0}
          role="region"
          aria-label={t("جدول سجل الأرباح", "Earnings ledger table")}
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 rounded-md"
        >
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-start text-xs text-muted">
                <th scope="col" className="py-2 text-start">{t("التاريخ", "Date")}</th>
                <th scope="col" className="py-2 text-start">{t("النوع", "Type")}</th>
                <th scope="col" className="py-2 text-start">{t("المبلغ", "Amount")}</th>
                <th scope="col" className="py-2 text-start">{t("الحالة", "Status")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const kind = KIND_COPY[entry.kind] ?? { ar: entry.kind, en: entry.kind };
                const status = STATUS_COPY[entry.status] ?? { ar: entry.status, en: entry.status };
                const hold = entry.hold_reason
                  ? (HOLD_COPY[entry.hold_reason] ?? { ar: entry.hold_reason, en: entry.hold_reason })
                  : null;
                const negative = entry.amount_cents < 0;
                return (
                  <tr key={entry.id} className="border-b border-white/5">
                    <td className="py-2 whitespace-nowrap text-muted">
                      {/* Explicit UTC (review P3): server runtime is UTC; an
                          implicit TZ could shift the calendar day. Safe from
                          hydration mismatch ONLY while this stays a server
                          component — do not add "use client" here. */}
                      {new Date(entry.created_at).toLocaleDateString(
                        lang === "ar" ? "ar-EG" : "en-US",
                        { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" },
                      )}
                    </td>
                    <td className="py-2">
                      {t(kind.ar, kind.en)}
                      {entry.kind === "debt_recovery" || entry.kind === "clawback" ? (
                        <span className="block text-xs text-muted">
                          {t("مرتبط بعملية استرداد/نزاع", "Linked to a refund/dispute")}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`py-2 whitespace-nowrap font-semibold ${negative ? "text-error" : ""}`}
                      dir="ltr"
                    >
                      {formatUsd(entry.amount_cents)}
                    </td>
                    <td className="py-2">
                      {t(status.ar, status.en)}
                      {hold ? (
                        <span className="block text-xs text-warning">{t(hold.ar, hold.en)}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
