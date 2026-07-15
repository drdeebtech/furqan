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
}

interface CheckoutResponse {
  success?: boolean;
  data?: {
    checkoutUrl?: string;
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
}: SingleSessionPurchaseProps) {
  const mounted = useSyncExternalStore(subscribeNoop, getSnapshotClient, getSnapshotServer);

  const options = useMemo(
    () => (mounted ? generateInstantSlotOptions(availability, { now: new Date() }) : []),
    [availability, mounted],
  );

  // Derive the effective selection (first slot until the student picks one) —
  // no effect syncing, so no stale-selection or set-state-in-effect issues.
  const [picked, setPicked] = useState("");
  const selectedIso = picked || options[0]?.iso || "";

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIso) return;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/stripe/checkout/single-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productType: "instant",
          teacherId,
          scheduledAt: selectedIso,
        }),
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
      <button
        type="submit"
        disabled={isLoading || !selectedIso}
        className="focus-ring w-full rounded-xl border border-gold/60 bg-transparent px-4 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? loadingLabel : `${buttonLabel}${priceLabel}`}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
