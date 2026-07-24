"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Sparkles } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { SESSION_TYPE_BILINGUAL } from "@/lib/constants";

/** Subjects a placement evaluation can target — the subject specialties only
 *  (muraja/combined/other are session formats, not assessable subjects). */
const EVALUATION_SPECIALTIES = ["hifz", "tajweed", "tilawa", "qiraat", "tafsir"] as const;

type Phase = "idle" | "pending" | "booked";

interface BookEvaluationFormProps {
  paypalEnabled?: boolean;
}

export function BookEvaluationForm({ paypalEnabled = false }: BookEvaluationFormProps) {
  const { t } = useLang();
  const [specialty, setSpecialty] = useState<string>("hifz");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const checkoutBody = { productType: "assessment", specialty };

  async function book() {
    setPhase("pending");
    setError(null);
    // Guard against a hung checkout endpoint leaving the form stuck on
    // "pending" forever (button + select disabled, no recovery but reload).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/stripe/checkout/single-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutBody),
        signal: controller.signal,
      });
      const json: { success?: boolean; data?: { bookingId?: string; checkoutUrl?: string }; error?: string } =
        await res.json().catch(() => ({}));

      if (res.ok && json.data?.checkoutUrl) {
        // Admin configured a non-zero evaluation price — hand off to Stripe.
        window.location.assign(json.data.checkoutUrl);
        return;
      }
      if (res.ok && json.data?.bookingId) {
        setPhase("booked");
        return;
      }
      setPhase("idle");
      if (res.status === 409) {
        setError(t(
          "لديك جلسة تقييم بالفعل — لكل طالب جلسة واحدة (يمكنك الحجز من جديد إذا أُلغيت).",
          "You already have an evaluation session — one per student (you can re-book if it was cancelled).",
        ));
      } else if (res.status === 422) {
        setError(t(
          "لا يتوفر حالياً معلم مقيِّم لهذا التخصص — جرّب تخصصاً آخر أو تواصل معنا.",
          "No evaluator is currently available for this subject — try another subject or contact us.",
        ));
      } else if (res.status === 403) {
        setError(t(
          "حجز جلسة التقييم متاح لحسابات الطلاب فقط.",
          "Evaluation booking is available for student accounts only.",
        ));
      } else {
        setError(t(
          "تعذر إتمام الحجز — حاول مرة أخرى.",
          "Booking failed — please try again.",
        ));
      }
    } catch {
      // Includes AbortError from the timeout above.
      setPhase("idle");
      setError(t("تعذر الاتصال بالخادم — تحقق من اتصالك وحاول مجدداً.", "Could not reach the server — check your connection and retry."));
    } finally {
      clearTimeout(timeout);
    }
  }

  async function handlePayPalBuy() {
    setPhase("pending");
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/paypal/checkout/single-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutBody),
        signal: controller.signal,
      });
      const json: { success?: boolean; data?: { approveUrl?: string }; error?: string } =
        await res.json().catch(() => ({}));

      if (res.ok && json.success && json.data?.approveUrl) {
        window.location.assign(json.data.approveUrl);
        return;
      }

      setPhase("idle");
      setError(
        json.error ??
          t(
            "تعذر بدء عملية الدفع. يرجى المحاولة مرة أخرى.",
            "Unable to start checkout. Please try again.",
          ),
      );
    } catch {
      setPhase("idle");
      setError(
        t(
          "تعذر الاتصال بالخادم — تحقق من اتصالك وحاول مجدداً.",
          "Could not reach the server — check your connection and retry.",
        ),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  if (phase === "booked") {
    return (
      <output className="mt-8 block rounded-2xl border border-gold/20 bg-surface/40 p-6">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="text-success" size={22} aria-hidden="true" />
          <h2 className="font-semibold">{t("تم حجز جلسة التقييم!", "Evaluation session booked!")}</h2>
        </div>
        <p className="mt-3 text-sm text-muted">
          {t(
            "سيتواصل معك فريقنا عبر واتساب لتأكيد الموعد المناسب لك.",
            "Our team will contact you on WhatsApp to confirm a time that works for you.",
          )}
        </p>
        <div className="mt-5">
          <Link
            href="/student/bookings"
            className="glass-gold glass-pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover focus-ring"
          >
            {t("عرض حجوزاتي", "View my bookings")}
          </Link>
        </div>
      </output>
    );
  }

  return (
    <div className="mt-8 rounded-2xl border border-gold/20 bg-surface/40 p-6">
      {error && (
        <p role="alert" aria-atomic="true" className="mb-4 rounded-lg glass-danger p-3 text-sm text-error">
          {error}
        </p>
      )}
      <label htmlFor="evaluation-specialty" className="mb-1.5 block">
        <span className="block text-sm font-medium">{t("ما الذي تريد تقييمه؟", "What would you like evaluated?")}</span>
      </label>
      <select
        id="evaluation-specialty"
        value={specialty}
        onChange={(e) => setSpecialty(e.target.value)}
        disabled={phase === "pending"}
        className="w-full rounded-xl glass-input px-4 py-2.5 text-foreground focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
      >
        {EVALUATION_SPECIALTIES.map((s) => (
          <option key={s} value={s}>
            {t(SESSION_TYPE_BILINGUAL[s].ar, SESSION_TYPE_BILINGUAL[s].en)}
          </option>
        ))}
      </select>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={book}
          disabled={phase === "pending"}
          aria-busy={phase === "pending"}
          className="glass-gold glass-pill inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full py-2.5 font-semibold text-background transition-colors hover:bg-gold-hover disabled:opacity-50 focus-ring"
        >
          {phase === "pending" ? (
            <>
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-background/30 border-t-background" aria-hidden="true" />
              <span className="sr-only">{t("جارٍ الحجز...", "Booking...")}</span>
            </>
          ) : (
            <>
              <Sparkles size={18} aria-hidden="true" />
              {t("احجز جلسة التقييم المجانية", "Book the free evaluation")}
            </>
          )}
        </button>
        {paypalEnabled && (
          <button
            type="button"
            onClick={handlePayPalBuy}
            disabled={phase === "pending"}
            className="glass-pill inline-flex min-h-[44px] flex-1 items-center justify-center border border-gold/40 px-6 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/10 focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === "pending"
              ? t("جارٍ التوجيه…", "Redirecting…")
              : t("الدفع عبر باي بال", "Pay with PayPal")}
          </button>
        )}
      </div>
    </div>
  );
}
