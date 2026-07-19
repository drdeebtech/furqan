"use client";

import { useState, useTransition } from "react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { approveSingleSessionRefund } from "@/lib/actions/admin/refund-single-session";

export function RefundSingleSessionForm() {
  const { t } = useLang();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [bookingId, setBookingId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const canSubmit = bookingId.trim().length > 0 && !pending;

  const submit = () => {
    if (!canSubmit) return;
    start(async () => {
      try {
        const res = await approveSingleSessionRefund({ bookingId: bookingId.trim() });
        if (res.ok) {
          const amount = res.amountUsd.toFixed(2);
          toast.success(t(`تم استرداد ${amount}$`, `Refunded $${amount}`));
          setLastResult(
            t(
              `تم — استرداد ${amount}$، وسيُلغى الحجز بعد التأكيد (طلب ${res.refundRequestId})`,
              `Done — refunded $${amount}; the booking will cancel on confirmation (request ${res.refundRequestId})`,
            ),
          );
          setBookingId("");
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
    "min-h-11 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold/40";

  return (
    <section className="glass-card rounded-xl p-4" aria-labelledby="refund-single-session-heading">
      <h3 id="refund-single-session-heading" className="mb-1 text-sm font-semibold text-gold">
        {t("استرداد جلسة مفردة", "Refund single session")}
      </h3>
      <p className="mb-3 text-xs text-muted">
        {t(
          "يسترد كامل دفعة Stripe للجلسة، ويُلغى الحجز بعد تأكيد الاسترداد.",
          "Refunds the full Stripe payment; the booking cancels after refund confirmation.",
        )}
      </p>

      <div className="flex max-w-md flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span>{t("معرّف الحجز", "Booking id")}</span>
          <input
            className={inputClass}
            value={bookingId}
            onChange={(e) => {
              setBookingId(e.target.value);
              setConfirming(false);
            }}
            placeholder="00000000-0000-0000-0000-000000000000"
            disabled={pending}
            dir="ltr"
            required
          />
        </label>

        {!confirming ? (
          <button
            type="button"
            className="min-h-11 self-start rounded-md border border-gold/30 bg-gold/15 px-4 py-2 text-sm font-medium text-gold hover:bg-gold/25 disabled:opacity-50"
            disabled={!canSubmit}
            onClick={() => setConfirming(true)}
          >
            {t("استرداد", "Refund")}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-red-400">
              {t(
                "تأكيد استرداد كامل دفعة هذه الجلسة؟ لا يمكن التراجع.",
                "Confirm refunding this session in full? This cannot be undone.",
              )}
            </span>
            <button
              type="button"
              className="min-h-11 rounded-md border border-error/30 bg-error/10 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-error/20 disabled:opacity-50"
              disabled={!canSubmit}
              onClick={submit}
            >
              {pending ? t("جارٍ…", "Working…") : t("تأكيد", "Confirm")}
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50"
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
