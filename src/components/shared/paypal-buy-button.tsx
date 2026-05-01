"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { useLang } from "@/lib/i18n/context";
import { createPackageOrder, captureAndGrantPackage } from "@/app/(public)/packages/paypal-actions";

type Currency = "USD" | "GBP" | "SAR" | "AUD";

interface Props {
  packageId: string;
  currency: Currency;
}

export function PayPalBuyButton({ packageId, currency }: Props) {
  const { t, dir } = useLang();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

  // SAR isn't supported by PayPal — render a friendly redirect to USD
  // instead of mounting the SDK with an unsupported currency.
  if (currency === "SAR") {
    return (
      <div
        dir={dir}
        className="rounded-full border border-surface-border/60 bg-surface/40 px-4 py-2.5 text-center text-xs text-muted"
      >
        {t(
          "PayPal لا يدعم الريال — اختر USD أو GBP أو AUD",
          "PayPal does not support SAR — pick USD, GBP, or AUD",
        )}
      </div>
    );
  }

  if (!clientId) {
    return (
      <div
        dir={dir}
        className="rounded-full border border-error/30 bg-error/10 px-4 py-2.5 text-center text-xs text-error"
      >
        {t("الدفع غير مهيأ بعد", "Payment not configured")}
      </div>
    );
  }

  return (
    <div dir={dir} className="space-y-2">
      <PayPalScriptProvider
        options={{
          clientId,
          currency,
          intent: "capture",
        }}
      >
        <PayPalButtons
          style={{
            layout: "vertical",
            shape: "pill",
            label: "paypal",
          }}
          createOrder={async () => {
            setError(null);
            const result = await createPackageOrder({ packageId, currency });
            if (!result.ok) {
              setError(result.error);
              throw new Error(result.error);
            }
            return result.orderId;
          }}
          onApprove={async (data) => {
            const result = await captureAndGrantPackage({ orderId: data.orderID });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.push("/student/packages?welcome=1");
            router.refresh();
          }}
          onError={(err) => {
            const msg = err instanceof Error ? err.message : String(err);
            setError(t("فشل الدفع. حاول مرة أخرى.", "Payment failed. Please try again."));
            console.error("[paypal] onError", msg);
          }}
        />
      </PayPalScriptProvider>

      {error && (
        <p className="text-center text-xs text-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
