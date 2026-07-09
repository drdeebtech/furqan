import { Clock, History, Wallet } from "lucide-react";
import { WidgetCard } from "@/components/shared/widget-card";
import { useLang } from "@/lib/i18n/context";
import { PREPAID_HOURS_POLICY } from "@/lib/copy/policies";

/**
 * Spec 038 — student dashboard prepaid-hour wallet widget (T6.2).
 *
 * Renders ONLY when `wallet` is non-null (the view returns null for
 * subscription-only students with no prepaid lots). Reads are upstream in
 * `studentDashboardView` — pure RLS `.from()` selects, no RPC. Visual language
 * mirrors `GoalCard` (WidgetCard + dl/dd grid + gold accent). Full Arabic RTL
 * via the shared `useLang` t() helper; numbers/dates are LTR-locked.
 */

export interface PrepaidWalletData {
  balanceHours: number;
  nearestExpiry: string | null;
  lots: {
    id: string;
    sessionsTotal: number;
    sessionsUsed: number;
    remaining: number;
    expiresAt: string | null;
    ratePaidUsd: number | null;
    purchasedAt: string;
  }[];
  history: { eventType: string; hoursDelta: number; createdAt: string }[];
}

interface PrepaidWalletCardProps {
  wallet: PrepaidWalletData;
}

const EVENT_LABELS: Record<string, { ar: string; en: string }> = {
  grant: { ar: "شراء ساعات", en: "Hours purchased" },
  draw: { ar: "حجز استهلك ساعة", en: "Booking used an hour" },
  restore: { ar: "استعادة ساعة", en: "Hour restored" },
  expired: { ar: "انتهت صلاحية ساعات", en: "Hours expired" },
  refunded: { ar: "استرداد ساعات", en: "Hours refunded" },
};

export function PrepaidWalletCard({ wallet }: PrepaidWalletCardProps) {
  const { t, lang } = useLang();
  const locale = lang === "ar" ? "ar-EG" : "en-US";

  const expiryLabel = wallet.nearestExpiry
    ? new Date(wallet.nearestExpiry).toLocaleDateString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <WidgetCard
      title={t(PREPAID_HOURS_POLICY.short.ar, PREPAID_HOURS_POLICY.short.en)}
      subtitle={t("رصيدك من الساعات المدفوعة مسبقاً", "Your prepaid hours balance")}
      headerAction={
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/5 px-2.5 py-1 text-[11px] font-medium text-gold">
          <Wallet size={12} aria-hidden="true" />
          {t("محفظة", "Wallet")}
        </span>
      }
    >
      {/* Balance + nearest expiry — the two numbers a wallet owner scans first. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted">{t("الرصيد الحالي", "Current balance")}</p>
          <p className="mt-1 text-3xl font-bold text-gold" dir="ltr">
            {wallet.balanceHours}
            <span className="ms-1.5 text-sm font-normal text-muted">
              {t("ساعة", "hrs")}
            </span>
          </p>
        </div>
        {expiryLabel && (
          <div className="text-right">
            <p className="flex items-center justify-end gap-1 text-xs text-muted">
              <Clock size={12} aria-hidden="true" />
              {t("أقرب انتهاء", "Nearest expiry")}
            </p>
            <p className="mt-1 text-sm font-medium" dir="ltr">
              {expiryLabel}
            </p>
          </div>
        )}
      </div>

      {/* Recent ledger — compact, signed, dated. Empty for a brand-new wallet
          that has only the grant event but no draws yet (still useful to show
          the grant). Caps at the 20 most recent rows from the view. */}
      {wallet.history.length > 0 && (
        <div className="mt-5 border-t border-card-border pt-4">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <History size={12} aria-hidden="true" />
            {t("آخر الحركات", "Recent activity")}
          </h4>
          <ul className="mt-2 space-y-1.5">
            {wallet.history.map((ev, i) => {
              const label = EVENT_LABELS[ev.eventType] ?? {
                ar: ev.eventType,
                en: ev.eventType,
              };
              const positive = ev.hoursDelta > 0;
              const dateLabel = new Date(ev.createdAt).toLocaleDateString(locale, {
                month: "short",
                day: "numeric",
              });
              return (
                <li
                  key={`${ev.eventType}-${i}`}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-muted">{t(label.ar, label.en)}</span>
                  <span className="flex items-center gap-2">
                    <span
                      dir="ltr"
                      className={
                        positive ? "font-semibold text-success" : "font-semibold text-error"
                      }
                    >
                      {positive ? "+" : ""}
                      {ev.hoursDelta}
                    </span>
                    <span className="text-xs text-muted-light" dir="ltr">
                      {dateLabel}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}
