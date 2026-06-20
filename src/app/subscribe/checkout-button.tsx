"use client";

import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";

interface CheckoutButtonProps {
  planCode: string;
}

export function CheckoutButton({ planCode }: CheckoutButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleCheckout() {
    setStatus("loading");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
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
        setStatus("error");
        return;
      }
      window.location.href = data.url;
    } catch {
      setErrorMsg("تعذر الاتصال — تحقق من الإنترنت. Connection failed, check your internet.");
      setStatus("error");
    }
  }

  return (
    <div className="space-y-3">
      {errorMsg && (
        <div role="alert" className="rounded-xl glass-danger p-3 text-sm text-error">
          {errorMsg}
        </div>
      )}
      <button
        type="button"
        onClick={handleCheckout}
        disabled={status === "loading"}
        className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-full glass-gold glass-pill px-8 py-3 font-semibold text-background transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {status === "loading" ? (
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        ) : (
          <CreditCard size={18} aria-hidden="true" />
        )}
        {status === "loading" ? "جارٍ التحويل…" : "تأكيد الدفع · Confirm & Pay"}
      </button>
    </div>
  );
}
