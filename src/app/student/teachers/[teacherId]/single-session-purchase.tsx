"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { generateInstantSlotOptions } from "@/lib/domains/single-sessions/instant-slot-options";

interface SingleSessionPurchaseProps {
  teacherId: string;
  availability: {
    day_of_week: number;
    start_time: string;
    end_time: string;
  }[];
  priceUsd: number | null;
  lang: "ar" | "en";
  paypalEnabled?: boolean;
}

interface CheckoutResponse {
  success?: boolean;
  data?: {
    checkoutUrl?: string;
    approveUrl?: string;
    bookingId?: string;
  };
  error?: string;
}

function isCheckoutResponse(value: unknown): value is CheckoutResponse {
  return typeof value === "object" && value !== null;
}

// Hydration-safe "am I on the client?" — returns false during SSR/hydration,
// true afterwards, with no set-state-in-effect. Slots depend on `new Date()`
// (student's timezone), so they must only be computed client-side to avoid a
// hydration mismatch on this payment surface.
const subscribeNoop = (): (() => void) => () => {};
const getSnapshotClient = (): boolean => true;
const getSnapshotServer = (): boolean => false;

export function SingleSessionPurchase({
  teacherId,
  availability,
  priceUsd,
  lang,
  paypalEnabled = false,
}: SingleSessionPurchaseProps) {
  const mounted = useSyncExternalStore(subscribeNoop, getSnapshotClient, getSnapshotServer);

  const options = useMemo(
    () => (mounted ? generateInstantSlotOptions(availability, { now: new Date(), lang }) : []),
    [availability, mounted, lang],
  );

  // Derive the effective selection (first slot until the student picks one) —
  // no effect syncing, so no stale-selection or set-state-in-effect issues.
  const [picked, setPicked] = useState("");
  const selectedIso = picked || options[0]?.iso || "";
  const selected = options.find((option) => option.iso === selectedIso);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildCheckoutBody() {
    if (!selected) return null;
    return {
      productType: "instant",
      teacherId,
      scheduledAt: selected.iso,
      // Student-local wall-clock — the server validates availability with
      // these (never by re-deriving wall-clock from the UTC instant in its
      // own timezone). Mirrors the subscription booking-form contract.
      dayOfWeek: selected.dayOfWeek,
      localDate: selected.localDate,
      localTime: selected.localTime,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checkoutBody = buildCheckoutBody();
    if (!checkoutBody) return;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/stripe/checkout/single-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkoutBody),
      });
      const parsed: unknown = await response.json();
      const body = isCheckoutResponse(parsed) ? parsed : {};

      if (response.ok && body.success && body.data?.checkoutUrl) {
        window.location.assign(body.data.checkoutUrl);
        return;
      }

      if (body.data?.bookingId) {
        window.location.assign("/student/dashboard?single_session=success");
        return;
      }

      setError(
        body.error ??
          (lang === "ar"
            ? "تعذر بدء عملية الدفع. يرجى المحاولة مرة أخرى."
            : "Unable to start checkout. Please try again."),
      );
    } catch {
      setError(
        lang === "ar"
          ? "تعذر بدء عملية الدفع. يرجى المحاولة مرة أخرى."
          : "Unable to start checkout. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePayPalBuy() {
    const checkoutBody = buildCheckoutBody();
    if (!checkoutBody) return;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/paypal/checkout/single-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(checkoutBody),
      });
      const parsed: unknown = await response.json();
      const body = isCheckoutResponse(parsed) ? parsed : {};

      if (response.ok && body.success && body.data?.approveUrl) {
        window.location.assign(body.data.approveUrl);
        return;
      }

      setError(
        body.error ??
          (lang === "ar"
            ? "تعذر بدء عملية الدفع. يرجى المحاولة مرة أخرى."
            : "Unable to start checkout. Please try again."),
      );
    } catch {
      setError(
        lang === "ar"
          ? "تعذر بدء عملية الدفع. يرجى المحاولة مرة أخرى."
          : "Unable to start checkout. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  // Deterministic placeholder for SSR / pre-mount so hydration matches.
  if (!mounted) {
    return (
      <p className="mt-3 text-center text-sm text-muted">
        {lang === "ar" ? "جارٍ تحميل المواعيد..." : "Loading times..."}
      </p>
    );
  }

  if (options.length === 0) {
    return (
      <p className="mt-3 text-center text-sm text-muted">
        {lang === "ar" ? "لا توجد مواعيد متاحة حالياً" : "No times available right now"}
      </p>
    );
  }

  const buttonLabel = lang === "ar" ? "ادفع مقابل جلسة واحدة" : "Pay for one session";
  const loadingLabel = lang === "ar" ? "جارٍ التحويل..." : "Redirecting...";
  const priceLabel = priceUsd === null ? "" : ` — $${priceUsd.toFixed(0)}`;

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-card mt-3 space-y-3 rounded-xl border border-gold/30 p-4"
      dir={lang === "ar" ? "rtl" : "ltr"}
    >
      <label htmlFor="instant-session-slot" className="block text-sm font-medium text-muted">
        {lang === "ar" ? "اختر موعد الجلسة" : "Choose a session time"}
      </label>
      <select
        id="instant-session-slot"
        value={selectedIso}
        onChange={(event) => setPicked(event.target.value)}
        className="focus-ring glass w-full rounded-xl px-3 py-2 text-sm text-foreground"
      >
        {options.map((option) => (
          <option key={option.iso} value={option.iso}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="submit"
          disabled={isLoading || !selectedIso}
          className="focus-ring inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-gold/60 bg-transparent px-4 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? loadingLabel : `${buttonLabel}${priceLabel}`}
        </button>
        {paypalEnabled && (
          <button
            type="button"
            onClick={handlePayPalBuy}
            disabled={isLoading || !selectedIso}
            className="glass-pill inline-flex min-h-[44px] flex-1 items-center justify-center border border-gold/40 px-6 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/10 focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading
              ? loadingLabel
              : lang === "ar"
                ? "الدفع عبر باي بال"
                : "Pay with PayPal"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
