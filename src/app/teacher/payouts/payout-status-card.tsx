"use client";

// Spec 040 FR-004 — the payout-status card: the 4 Connect states + the
// manual rail. The button calls startConnectOnboarding() and redirects to
// the Stripe-hosted flow; expired links are healed by clicking again
// (create-or-reuse + fresh Account Link server-side).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startConnectOnboarding } from "@/lib/actions/teacher-payouts";
import type { ConnectAccountStatus } from "@/lib/domains/connect/connect-accounts";

interface PayoutStatusCardProps {
  status: ConnectAccountStatus;
  payoutMethod: "stripe_connect" | "manual";
  /** FR-021 dormancy: until connect_cutover_date is armed, never route a
   *  real teacher into (test-mode) Stripe onboarding — show "coming soon". */
  connectLive: boolean;
  lang: "ar" | "en";
}

const STATUS_COPY: Record<
  ConnectAccountStatus,
  { ar: string; en: string; tone: "muted" | "pending" | "ok" }
> = {
  none: {
    ar: "لم يتم إعداد المدفوعات بعد — ابدأ الإعداد لاستلام أرباحك.",
    en: "Payouts are not set up yet — start setup to receive your earnings.",
    tone: "muted",
  },
  onboarding_incomplete: {
    ar: "الإعداد غير مكتمل — أكمل بياناتك لدى Stripe.",
    en: "Onboarding incomplete — finish your details with Stripe.",
    tone: "pending",
  },
  pending_verification: {
    ar: "بياناتك قيد التحقق لدى Stripe — لا يلزمك إجراء الآن.",
    en: "Your details are being verified by Stripe — nothing to do right now.",
    tone: "pending",
  },
  payouts_enabled: {
    ar: "المدفوعات مفعّلة — تُحوَّل أرباحك المستحقة تلقائيًا.",
    en: "Payouts are enabled — your due earnings transfer automatically.",
    tone: "ok",
  },
};

export function PayoutStatusCard({ status, payoutMethod, connectLive, lang }: PayoutStatusCardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  const begin = () => {
    setError(null);
    startTransition(async () => {
      const result = await startConnectOnboarding();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.kind === "stripe") {
        window.location.assign(result.url);
        return;
      }
      // manual / already_enabled: the server state moved — re-render.
      router.refresh();
    });
  };

  if (payoutMethod === "manual") {
    return (
      <section className="glass-card rounded-xl p-6" aria-labelledby="payout-status-heading">
        <h2 id="payout-status-heading" className="mb-2 text-lg font-bold">
          {t("حالة المدفوعات", "Payout status")}
        </h2>
        <p className="text-sm text-muted">
          {t(
            "تُسوّى أرباحك يدويًا عبر إدارة المنصة — لا يلزمك أي إعداد.",
            "Your earnings are settled manually by the academy — no setup needed.",
          )}
        </p>
      </section>
    );
  }

  const copy = STATUS_COPY[status];
  const toneClass =
    copy.tone === "ok"
      ? "border-success/30 bg-success/10 text-success"
      : copy.tone === "pending"
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
        : "border-white/10 bg-black/20 text-muted";

  return (
    <section className="glass-card rounded-xl p-6" aria-labelledby="payout-status-heading">
      <h2 id="payout-status-heading" className="mb-2 text-lg font-bold">
        {t("حالة المدفوعات", "Payout status")}
      </h2>
      <p className={`mb-4 rounded-lg border p-3 text-sm ${toneClass}`}>
        {lang === "ar" ? copy.ar : copy.en}
      </p>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {!connectLive ? (
        <p className="text-sm text-muted">
          {t(
            "سيتاح إعداد المدفوعات قريبًا — ستصلك إشعارات عند التفعيل.",
            "Payout setup is coming soon — you will be notified when it opens.",
          )}
        </p>
      ) : status !== "payouts_enabled" && status !== "pending_verification" ? (
        <button
          type="button"
          onClick={begin}
          disabled={isPending}
          className="glass-button rounded-lg px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending
            ? t("جارٍ التحويل…", "Redirecting…")
            : status === "none"
              ? t("إعداد المدفوعات", "Set up payouts")
              : t("متابعة الإعداد", "Continue setup")}
        </button>
      ) : null}
    </section>
  );
}
