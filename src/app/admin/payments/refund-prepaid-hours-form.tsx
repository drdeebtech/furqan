"use client";

import { useState, useTransition } from "react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { approvePrepaidRefund } from "@/lib/actions/admin/refund-prepaid-hours";

/**
 * Admin control for T5.4 — approve a prepaid-hour wallet refund.
 *
 * Thin trigger over the verified `approvePrepaidRefund` server action (which
 * owns requireAdmin + the whole reserve → Stripe refund → release saga). This
 * component only collects the lot id + hours, forces an explicit confirm (a
 * refund moves money), and surfaces the result. All money logic + auth live
 * server-side; this is UI only. Styled with the admin glass design system.
 */
export function RefundPrepaidHoursForm() {
  const { t } = useLang();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [lotId, setLotId] = useState("");
  const [hours, setHours] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const parsedHours = Number(hours);
  const validHours = Number.isInteger(parsedHours) && parsedHours > 0;
  const canSubmit = lotId.trim().length > 0 && validHours && !pending;

  const submit = () => {
    if (!canSubmit) return;
    start(async () => {
      // `finally` guarantees the confirmation/submitting UI never gets stuck
      // — even if the server action THROWS (network drop, RLS denial, an
      // unhandled server error). The success path keeps its existing
      // behavior; the catch surfaces a thrown error to the user via the same
      // toast + lastResult channel as a returned {ok:false}.
      try {
        const res = await approvePrepaidRefund({ lotId: lotId.trim(), hours: parsedHours });
        if (res.ok) {
          toast.success(t(`تم استرداد ${res.amountUsd}$`, `Refunded $${res.amountUsd}`));
          setLastResult(
            t(
              `تم — استرداد ${res.amountUsd}$ (طلب ${res.refundRequestId})`,
              `Done — refunded $${res.amountUsd} (request ${res.refundRequestId})`,
            ),
          );
          setLotId("");
          setHours("");
        } else {
          toast.error(res.error);
          setLastResult(t(`فشل: ${res.error}`, `Failed: ${res.error}`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "error";
        toast.error(msg);
        setLastResult(t(`فشل: ${msg}`, `Failed: ${msg}`));
      } finally {
        setConfirming(false);
      }
    });
  };

  const inputClass =
    "w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/40";

  return (
    <section className="glass-card rounded-xl p-4" aria-labelledby="refund-prepaid-heading">
      <h3 id="refund-prepaid-heading" className="mb-1 text-sm font-semibold text-gold">
        {t("استرداد ساعات مدفوعة مسبقاً", "Refund prepaid hours")}
      </h3>
      <p className="mb-3 text-xs text-muted">
        {t(
          "يُخصم الاسترداد من الساعات غير المستخدمة بسعرها المُثبَّت وقت الشراء عبر Stripe.",
          "Refunds unused hours at the rate frozen at purchase, via Stripe.",
        )}
      </p>

      <div className="flex max-w-md flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span>{t("معرّف الرصيد (lot id)", "Lot id")}</span>
          <input
            className={inputClass}
            value={lotId}
            onChange={(e) => {
              setLotId(e.target.value);
              setConfirming(false);
            }}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={pending}
            dir="ltr"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          <span>{t("عدد الساعات", "Hours")}</span>
          <input
            className={inputClass}
            value={hours}
            onChange={(e) => {
              setHours(e.target.value);
              setConfirming(false);
            }}
            inputMode="numeric"
            placeholder="1"
            disabled={pending}
            dir="ltr"
          />
        </label>

        {!confirming ? (
          <button
            type="button"
            className="self-start rounded-md border border-gold/30 bg-gold/15 px-4 py-2 text-sm font-medium text-gold hover:bg-gold/25 disabled:opacity-50"
            disabled={!canSubmit}
            onClick={() => setConfirming(true)}
          >
            {t("استرداد", "Refund")}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-red-400">
              {t(
                `تأكيد استرداد ${parsedHours} ساعة؟ لا يمكن التراجع.`,
                `Confirm refunding ${parsedHours} hour(s)? This cannot be undone.`,
              )}
            </span>
            <button
              type="button"
              className="rounded-md border border-error/30 bg-error/10 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-error/20 disabled:opacity-50"
              disabled={!canSubmit}
              onClick={submit}
            >
              {pending ? t("جارٍ…", "Working…") : t("تأكيد", "Confirm")}
            </button>
            <button
              type="button"
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              {t("إلغاء", "Cancel")}
            </button>
          </div>
        )}

        {lastResult && (
          <p className="text-xs text-muted" role="status">
            {lastResult}
          </p>
        )}
      </div>
    </section>
  );
}
