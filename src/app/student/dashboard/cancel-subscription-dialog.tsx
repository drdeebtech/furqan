"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { cancelCurrentStudentPayPalSubscription } from "./subscription-actions";

interface CancelSubscriptionDialogProps {
  currentPeriodEnd: string | null;
  onCanceled: () => void;
}

export function CancelSubscriptionDialog({
  currentPeriodEnd,
  onCanceled,
}: CancelSubscriptionDialogProps) {
  const router = useRouter();
  const { t, dir, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const keepSubscriptionButtonRef = useRef<HTMLButtonElement>(null);

  const periodEndLabel = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  function confirmCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelCurrentStudentPayPalSubscription();
      if (result.ok) {
        onCanceled();
        setOpen(false);
        router.refresh();
        return;
      }
      setError(result.error);
    });
  }

  useEffect(() => {
    if (!open) return;

    keepSubscriptionButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, pending]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-error/30 bg-error/5 px-4 py-2 text-sm font-medium text-error transition-colors hover:bg-error/10 focus-ring"
      >
        {t("إلغاء الاشتراك", "Cancel subscription")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 py-6 backdrop-blur-sm"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-subscription-title"
            dir={dir}
            className="glass-card w-full max-w-md border-error/20 p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-error/10 text-error">
                  <AlertTriangle size={20} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 id="cancel-subscription-title" className="text-base font-semibold text-foreground">
                    {t("إلغاء اشتراك PayPal", "Cancel PayPal subscription")}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {t("تتوقف الفوترة الآن.", "Billing stops now.")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("إغلاق", "Close")}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
                disabled={pending}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 space-y-3 text-sm leading-relaxed text-foreground/90">
              <BilingualLine
                ar="سيتم إيقاف فوترة PayPal لهذا الاشتراك فوراً."
                en="PayPal billing for this subscription will stop immediately."
                lang={lang}
              />
              <BilingualLine
                ar={
                  periodEndLabel
                    ? `تبقى جلساتك متاحة حتى نهاية الفترة الحالية في ${periodEndLabel}.`
                    : "تبقى جلساتك المتاحة صالحة حتى تاريخ انتهاء كل جلسة ممنوحة."
                }
                en={
                  periodEndLabel
                    ? `Your sessions stay usable until the current period ends on ${periodEndLabel}.`
                    : "Your granted sessions stay usable until each granted package expires."
                }
                lang={lang}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error"
              >
                <p>{error}</p>
                <p className="mt-1" lang={lang === "ar" ? "en" : "ar"} dir={lang === "ar" ? "ltr" : "rtl"}>
                  {t("Please try again.", "يرجى المحاولة مرة أخرى.")}
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={keepSubscriptionButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-card-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 focus-ring disabled:opacity-60"
              >
                {t("الرجوع", "Keep subscription")}
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-error px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-error/90 focus-ring disabled:opacity-70"
              >
                {pending && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {pending ? t("جارٍ الإلغاء", "Canceling") : t("تأكيد الإلغاء", "Confirm cancellation")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BilingualLine({
  ar,
  en,
  lang,
}: {
  ar: string;
  en: string;
  lang: string;
}) {
  const primary = lang === "ar" ? ar : en;
  const secondary = lang === "ar" ? en : ar;

  return (
    <div className="space-y-1">
      <p>{primary}</p>
      <p
        className="text-muted"
        lang={lang === "ar" ? "en" : "ar"}
        dir={lang === "ar" ? "ltr" : "rtl"}
      >
        {secondary}
      </p>
    </div>
  );
}
