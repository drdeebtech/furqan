"use client";

import { useState } from "react";
import { CreditCard, Wallet, Loader2 } from "lucide-react";

type Provider = "stripe" | "paypal";

interface CheckoutButtonProps {
  planCode: string;
  /** Renders the "Pay with PayPal" button — true only when PayPal is both
   *  configured (PAYPAL_* env) and flagged on (paypal_subscription_enabled),
   *  resolved server-side by the /subscribe page. */
  paypalEnabled?: boolean;
}

const PROVIDER_ENDPOINT: Record<Provider, string> = {
  stripe: "/api/stripe/checkout",
  paypal: "/api/paypal/checkout/subscription",
};

export function CheckoutButton({ planCode, paypalEnabled = false }: CheckoutButtonProps) {
  // `loading` holds which provider is mid-request so only that button spins.
  const [loading, setLoading] = useState<Provider | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleCheckout(provider: Provider) {
    setLoading(provider);
    setErrorMsg(null);
    try {
      const res = await fetch(PROVIDER_ENDPOINT[provider], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const data: { url?: string; error?: string } = await res.json();
      if (!res.ok || !data.url) {
        if (res.status === 409) {
          setErrorMsg("لديك اشتراك حفظ نشط بالفعل. You already have an active Hifz subscription.");
        } else if (res.status === 401) {
          window.location.href = `/login?redirect=/subscribe?plan=${encodeURIComponent(planCode)}`;
          return;
        } else {
          setErrorMsg(data.error ?? "حدث خطأ — حاول مرة أخرى. An error occurred, please try again.");
        }
        setLoading(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      setErrorMsg("تعذر الاتصال — تحقق من الإنترنت. Connection failed, check your internet.");
      setLoading(null);
    }
  }

  const busy = loading !== null;

  return (
    <div className="space-y-3">
      {errorMsg && (
        <div role="alert" className="rounded-xl glass-danger p-3 text-sm text-error">
          {errorMsg}
        </div>
      )}
      <button
        type="button"
        onClick={() => handleCheckout("stripe")}
        disabled={busy}
        className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-full glass-gold glass-pill px-8 py-3 font-semibold text-background transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {loading === "stripe" ? (
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        ) : (
          <CreditCard size={18} aria-hidden="true" />
        )}
        {loading === "stripe" ? "جارٍ التحويل…" : "تأكيد الدفع · Confirm & Pay"}
      </button>

      {paypalEnabled && (
        <button
          type="button"
          onClick={() => handleCheckout("paypal")}
          disabled={busy}
          className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-full glass-pill border border-gold/40 px-8 py-3 font-semibold text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
        >
          {loading === "paypal" ? (
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          ) : (
            <Wallet size={18} aria-hidden="true" />
          )}
          {loading === "paypal" ? "جارٍ التحويل…" : "الدفع عبر باي بال · Pay with PayPal"}
        </button>
      )}
    </div>
  );
}
