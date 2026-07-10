import { ExternalLink, Inbox, Receipt } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { EmptyState } from "@/components/shared/empty-state";
import { safeHref } from "@/lib/security/safe-url";
import { PAYMENTS_HISTORY_LIMIT, type BillingRow } from "@/lib/views/student-billing";
import type { PaymentStatus } from "@/types/database";

/**
 * Presentational billing-history list for `/student/billing` — a Server
 * Component (no interactivity, so no client JS ships). All data is prepared
 * upstream in the page; this only formats + renders, RTL-correct via `getT()`.
 * Money and dates are LTR-locked (`dir="ltr"`) inside an RTL layout.
 */

interface BillingHistoryProps {
  rows: BillingRow[];
  /** PaymentIntent id → Stripe receipt URL (or null). Best-effort; may be empty. */
  receiptUrls: Record<string, string | null>;
}

const STATUS_STYLE: Record<PaymentStatus, string> = {
  succeeded: "border-success/30 bg-success/10 text-success",
  pending: "border-gold/30 bg-gold/10 text-gold",
  failed: "border-error/30 bg-error/10 text-error",
  refunded: "border-muted/40 bg-muted/10 text-muted",
};

const STATUS_LABEL: Record<PaymentStatus, { ar: string; en: string }> = {
  succeeded: { ar: "مدفوع", en: "Paid" },
  pending: { ar: "قيد المعالجة", en: "Pending" },
  failed: { ar: "فشل", en: "Failed" },
  refunded: { ar: "مسترد", en: "Refunded" },
};

/** A booking-linked payment is a single session; otherwise a subscription/package. */
function typeLabel(row: BillingRow): { ar: string; en: string } {
  return row.bookingId
    ? { ar: "جلسة مفردة", en: "Single session" }
    : { ar: "اشتراك / باقة", en: "Subscription / package" };
}

/**
 * Render the student's billing history: one row per payment with type, date,
 * amount (plus local currency when present), status, and a link to Stripe's
 * hosted receipt. Shows an empty state when there are no payments, and a
 * truncation note when the {@link PAYMENTS_HISTORY_LIMIT} cap is reached.
 *
 * @param rows        Payment rows from `studentBillingView`, newest first.
 * @param receiptUrls PaymentIntent id → resolved Stripe receipt URL (best-effort; may be empty).
 */
export async function BillingHistory({ rows, receiptUrls }: BillingHistoryProps) {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  // Financial figures + dates use Western (Latin) digits even in Arabic — they
  // match the linked Stripe receipt and are the convention for money/records.
  const money = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    numberingSystem: "latn",
  });
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      numberingSystem: "latn",
    });

  return (
    <div dir={dir} className="mx-auto w-full max-w-3xl px-4 py-6 md:px-0">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Receipt size={22} className="text-gold" aria-hidden="true" />
          {t("الفواتير والإيصالات", "Billing & receipts")}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {t(
            "سجل مدفوعاتك مع روابط الإيصالات الرسمية من سترايب.",
            "Your payment history with official Stripe receipt links.",
          )}
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" aria-hidden="true" />}
          message={t("لا توجد مدفوعات بعد", "No payments yet")}
          hint={t(
            "ستظهر مدفوعاتك وإيصالاتك هنا بعد أول عملية شراء.",
            "Your payments and receipts will appear here after your first purchase.",
          )}
        />
      ) : (
        <ul className="glass-card divide-y divide-card-border p-0">
          {rows.map((row) => {
            const type = typeLabel(row);
            const status = STATUS_LABEL[row.status];
            const rawReceipt = row.stripePaymentIntent
              ? receiptUrls[row.stripePaymentIntent]
              : null;
            const receiptHref = rawReceipt ? safeHref(rawReceipt) : null;
            const hasReceipt = Boolean(receiptHref && receiptHref !== "#");

            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{t(type.ar, type.en)}</p>
                  <p className="mt-0.5 text-xs text-muted" dir="ltr">
                    {fmtDate(row.paidAt ?? row.createdAt)}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex flex-col items-end" dir="ltr">
                    <span className="text-sm font-semibold text-foreground">
                      {money.format(row.amountUsd)}
                    </span>
                    {row.localCurrency && row.amountLocal != null ? (
                      <span className="text-[11px] text-muted">
                        {row.amountLocal.toLocaleString(locale, { numberingSystem: "latn" })} {row.localCurrency}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[row.status]}`}
                  >
                    {t(status.ar, status.en)}
                  </span>
                  {hasReceipt ? (
                    <a
                      href={receiptHref as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-card-border px-3 py-2 text-xs text-muted transition-colors hover:text-foreground focus-ring"
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                      {t("الإيصال", "Receipt")}
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length >= PAYMENTS_HISTORY_LIMIT ? (
        <p className="mt-4 text-center text-xs text-muted">
          {t(
            `تُعرض أحدث ${PAYMENTS_HISTORY_LIMIT} عملية دفع فقط.`,
            `Showing the most recent ${PAYMENTS_HISTORY_LIMIT} payments only.`,
          )}
        </p>
      ) : null}
    </div>
  );
}
