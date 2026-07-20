"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle, Users, User, ChevronDown } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import { RegisterBanner } from "@/components/public/register-banner";
import { TRIAL_POLICY, ABSENCE_POLICY, SESSION_DURATION, PRICING_MODEL, FAMILY_POLICY, PREPAID_HOURS_POLICY } from "@/lib/copy/policies";
import { AyahQuote } from "@/components/quran/ayah-quote";

interface Plan {
  id: string;
  plan_code: string;
  name: string;
  monthly_credit_count: number;
  price_cents: number;
}

interface PlanTier {
  plans: Plan[];
  labelAr: string;
  labelEn: string;
  descAr: string;
  descEn: string;
  icon: React.ReactNode;
  features: { ar: string; en: string }[];
}

const GROUP_FEATURES: { ar: string; en: string }[] = [
  { ar: "تلاوة جماعية مع مجموعة صغيرة", en: "Recitation in small group settings" },
  { ar: "تصحيح التجويد والمخارج", en: "Tajweed and makhaarij correction" },
  { ar: "متابعة الحفظ أسبوعياً", en: "Weekly memorisation follow-up" },
  { ar: "جدول مرن يناسب مختلف المناطق", en: "Flexible schedule across time zones" },
];

const INDIVIDUAL_FEATURES: { ar: string; en: string }[] = [
  { ar: "جلسة خاصة 1:1 مع معلم متخصص", en: "Private 1:1 session with a specialist" },
  { ar: "منهج مخصص لمستواك وهدفك", en: "Curriculum tailored to your level and goal" },
  { ar: "مراجعة مكثفة وتقييم دوري", en: "Intensive review and regular assessment" },
  { ar: "مرونة كاملة في اختيار الأوقات", en: "Full flexibility in scheduling" },
];

function formatPrice(priceCents: number): string {
  return `$${(priceCents / 100).toFixed(0)}`;
}

/**
 * 2-decimal USD formatter for prepaid pricing. The prepaid rate ($10.25) and
 * its computed totals are real currency values, not rounded display tiers —
 * truncating to `toFixed(0)` showed "$10" while checkout charged $10.25.
 * Uses Intl with en-US currency so the digits/decimal are always correct;
 * the surrounding layout already wraps numeric spans with `dir="ltr"`.
 */
const formatUsd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

function sessionLabel(plan: Plan, t: (ar: string, en: string) => string): string {
  const n = plan.monthly_credit_count;
  if (plan.plan_code.startsWith("hifz_individual")) {
    return t(`${n} ساعة / شهر`, `${n} hours / month`);
  }
  return t(`${n} جلسات / شهر`, `${n} sessions / month`);
}

function PlanCard({
  plan,
  t,
}: {
  plan: Plan;
  t: (ar: string, en: string) => string;
}) {
  return (
    // No tier is singled out. The old "الأكثر طلباً / Most popular" badge sat on
    // the middle tier, but Stripe is pre-cutover and there are no subscribers —
    // it was a popularity claim over a population of zero. Restore it only from
    // real subscription counts. (Note that with the 2026-07-20 price ladder the
    // LARGEST tier is now the best per-session value, not the middle one.)
    <div className="relative">
      <div
        className="glass-card flex flex-col gap-4 p-6 transition-shadow duration-200 hover:shadow-gold/10 hover:shadow-lg h-full"
      >
        <div>
          <p className="text-xs font-medium text-muted">
            {sessionLabel(plan, t)}
          </p>
          <p className="font-display mt-1 text-3xl font-bold" dir="ltr">
            {formatPrice(plan.price_cents)}
            <span className="text-base font-normal text-muted"> / {t("شهر", "mo")}</span>
          </p>
        </div>
        <Link
          href={`/register?plan=${plan.plan_code}`}
          className="glass-gold glass-pill inline-flex min-h-[44px] items-center justify-center px-5 py-3 text-sm font-semibold text-background transition-colors hover:bg-gold-hover focus-ring"
        >
          {t("ابدأ الآن", "Get started")}
        </Link>
      </div>
    </div>
  );
}

function Tier({
  tier,
  t,
}: {
  tier: PlanTier;
  t: (ar: string, en: string) => string;
}) {

  return (
    <div className="glass-card p-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface text-muted">
          {tier.icon}
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold">
            {t(tier.labelAr, tier.labelEn)}
          </h2>
          <p className="mt-1 text-sm text-muted">{t(tier.descAr, tier.descEn)}</p>
        </div>
      </div>

      <div
        className={`grid items-end gap-4 ${tier.plans.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
      >
        {tier.plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} t={t} />
        ))}
      </div>

      <ul className="mt-6 grid gap-2 sm:grid-cols-2">
        {tier.features.map((f) => (
          <li key={f.en} className="flex items-start gap-2 text-sm">
            <CheckCircle size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
            <span className="text-muted">{t(f.ar, f.en)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface Faq {
  id: string;
  question_ar: string;
  question_en: string;
  answer_ar: string;
  answer_en: string;
}

/**
 * Spec 038 — prepaid-hour wallet config passed SERVER-SIDE only (T6.1).
 *
 * `prepaid` is null when the `prepaid_hours_purchase_enabled` flag is off; when
 * non-null, the "Pay as you go" card renders and the disambiguator line above
 * the plans switches to `PRICING_MODEL.disambiguatorWithPrepaid` (names all
 * three systems). All values come from platform_settings, parsed defensively
 * in the server page module; the client never re-derives rate or bounds.
 */
export interface PrepaidConfig {
  rateUsd: number;
  presets: number[];
  min: number;
  max: number;
}

/**
 * Spec 038 — "Pay as you go" prepaid-hours card (T6.1).
 *
 * Visual language mirrors PlanCard (glass-card, glass-gold CTA, min-h-[44px]
 * tap targets, focus-ring). State is local: the selected hour count is the
 * only piece of mutable state; presets are clamped into [min,max], the custom
 * number input is clamped on blur, and the live total = hours × rateUsd.
 *
 * Checkout: POST `/api/stripe/checkout/prepaid-hours` with `{ hours }`. The
 * route is the authority on rate/bounds (FR-002) — the client never sends a
 * price. 401 → /login?next=/pricing; 404/422/500 → inline bilingual error.
 * On success the browser is redirected to the Stripe Checkout URL.
 */
function PrepaidCard({
  prepaid,
  t,
  paypalEnabled,
}: {
  prepaid: PrepaidConfig;
  t: (ar: string, en: string) => string;
  paypalEnabled?: boolean;
}) {
  const presetValues = prepaid.presets
    .map((n) => Math.max(prepaid.min, Math.min(prepaid.max, Math.floor(n))))
    .filter((n, i, arr) => arr.indexOf(n) === i);

  const [selectedHours, setSelectedHours] = useState<number>(
    presetValues[0] ?? prepaid.min,
  );
  // Empty string = "no custom value typed"; presets set it back to "" so the
  // preset button is the highlighted source of truth when active.
  const [customInput, setCustomInput] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clamp = (n: number) => Math.max(prepaid.min, Math.min(prepaid.max, n));
  const presetSelected = customInput === "" && presetValues.includes(selectedHours);
  const totalPrice = selectedHours * prepaid.rateUsd;

  const handlePreset = (hours: number) => {
    setError(null);
    setCustomInput("");
    setSelectedHours(hours);
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const raw = e.target.value;
    setCustomInput(raw);
    if (raw === "") return;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      setSelectedHours(clamp(Math.floor(n)));
    }
  };

  const handleCustomBlur = () => {
    if (customInput === "") return;
    const n = Number(customInput);
    if (!Number.isFinite(n) || n <= 0) {
      setCustomInput("");
      return;
    }
    const clamped = clamp(Math.floor(n));
    setCustomInput(String(clamped));
    setSelectedHours(clamped);
  };

  const handleBuy = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout/prepaid-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: selectedHours }),
      });
      if (res.status === 401) {
        // Not signed in → send to login with a return-to-pricing next hop.
        window.location.href = "/login?next=/pricing";
        return;
      }
      if (!res.ok) {
        const fallback = t(
          "تعذّر بدء عملية الدفع. حاول مرة أخرى.",
          "Couldn't start checkout. Please try again.",
        );
        let msg = fallback;
        try {
          const body = await res.json();
          if (body?.error && typeof body.error === "string") msg = body.error;
        } catch {
          // keep default
        }
        setError(msg);
        setSubmitting(false);
        return;
      }
      const body = await res.json();
      const checkoutUrl: unknown = body?.data?.checkoutUrl;
      if (typeof checkoutUrl !== "string" || checkoutUrl.length === 0) {
        setError(
          t(
            "تعذّر بدء عملية الدفع. حاول مرة أخرى.",
            "Couldn't start checkout. Please try again.",
          ),
        );
        setSubmitting(false);
        return;
      }
      window.location.href = checkoutUrl;
    } catch {
      setError(
        t(
          "تعذّر الاتصال بالخادم. حاول مرة أخرى.",
          "Couldn't reach the server. Please try again.",
        ),
      );
      setSubmitting(false);
    }
  };

  // Spec 039 Phase 2c — PayPal checkout. Mirrors handleBuy but POSTs to the
  // PayPal prepaid-hours route and redirects to `approveUrl` (not checkoutUrl).
  // Same 401 → /login?next=/pricing, same loading/disabled state (shared
  // `submitting` flag so both buttons lock during either checkout), same
  // hours-only body — amount stays server-derived.
  const handlePayPalBuy = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/paypal/checkout/prepaid-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: selectedHours }),
      });
      if (res.status === 401) {
        window.location.href = "/login?next=/pricing";
        return;
      }
      if (!res.ok) {
        const fallback = t(
          "تعذّر بدء عملية الدفع. حاول مرة أخرى.",
          "Couldn't start checkout. Please try again.",
        );
        let msg = fallback;
        try {
          const body = await res.json();
          if (body?.error && typeof body.error === "string") msg = body.error;
        } catch {
          // keep default
        }
        setError(msg);
        setSubmitting(false);
        return;
      }
      const body = await res.json();
      const approveUrl: unknown = body?.data?.approveUrl;
      if (typeof approveUrl !== "string" || approveUrl.length === 0) {
        setError(
          t(
            "تعذّر بدء عملية الدفع. حاول مرة أخرى.",
            "Couldn't start checkout. Please try again.",
          ),
        );
        setSubmitting(false);
        return;
      }
      window.location.href = approveUrl;
    } catch {
      setError(
        t(
          "تعذّر الاتصال بالخادم. حاول مرة أخرى.",
          "Couldn't reach the server. Please try again.",
        ),
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="glass-card flex flex-col gap-5 p-6 sm:p-8">
      <div>
        <h3 className="font-display text-2xl font-bold">
          {t(PREPAID_HOURS_POLICY.short.ar, PREPAID_HOURS_POLICY.short.en)}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {t(PREPAID_HOURS_POLICY.long.ar, PREPAID_HOURS_POLICY.long.en)}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted">
          {t("اختر عدد الساعات", "Choose hours")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {presetValues.map((hours) => {
            const active = presetSelected && selectedHours === hours;
            return (
              <button
                key={hours}
                type="button"
                onClick={() => handlePreset(hours)}
                aria-pressed={active}
                className={[
                  "glass-pill inline-flex min-h-[44px] items-center justify-center px-4 py-2 text-sm font-semibold transition-colors focus-ring",
                  active
                    ? "glass-gold text-background"
                    : "border border-gold/40 text-gold hover:bg-gold/10",
                ].join(" ")}
              >
                <span dir="ltr">{hours}</span>
                <span className="mx-1" aria-hidden="true">·</span>
                {t("ساعة", "hrs")}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label
          htmlFor="prepaid-custom-hours"
          className="text-xs font-medium text-muted"
        >
          {t("أو أدخل عدداً مخصصاً", "Or enter a custom amount")}
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            id="prepaid-custom-hours"
            type="number"
            inputMode="numeric"
            min={prepaid.min}
            max={prepaid.max}
            step={1}
            value={customInput}
            onChange={handleCustomChange}
            onBlur={handleCustomBlur}
            placeholder={`${prepaid.min}–${prepaid.max}`}
            className="min-h-[44px] w-32 rounded-lg border border-gold/30 bg-surface px-3 py-2 text-sm text-foreground focus-ring"
            dir="ltr"
          />
          <span className="text-xs text-muted">
            {t(
              `الحد الأدنى ${prepaid.min}، الأقصى ${prepaid.max}`,
              `Min ${prepaid.min}, max ${prepaid.max}`,
            )}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <div>
          <p className="text-xs text-muted">{t("الإجمالي", "Total")}</p>
          <p className="font-display text-2xl font-bold" dir="ltr">
            {formatUsd(totalPrice)}
            <span className="ms-1 text-sm font-normal text-muted">
              ({selectedHours} × {formatUsd(prepaid.rateUsd)})
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={handleBuy}
          disabled={submitting}
          className="glass-gold glass-pill inline-flex min-h-[44px] items-center justify-center px-6 py-3 text-sm font-semibold text-background transition-colors hover:bg-gold-hover focus-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting
            ? t("جارٍ التوجيه…", "Redirecting…")
            : t("اشترِ الساعات", "Buy hours")}
        </button>
        {paypalEnabled && (
          <button
            type="button"
            onClick={handlePayPalBuy}
            disabled={submitting}
            className="glass-pill inline-flex min-h-[44px] items-center justify-center border border-gold/40 px-6 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/10 focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting
              ? t("جارٍ التوجيه…", "Redirecting…")
              : t("الدفع عبر باي بال", "Pay with PayPal")}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg glass-danger p-3 text-sm text-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function PricingContent({
  plans,
  faqs,
  prepaid,
  paypalEnabled,
}: {
  plans: Plan[];
  faqs: Faq[];
  prepaid: PrepaidConfig | null;
  paypalEnabled?: boolean;
}) {
  const { t } = useLang();
  const { hidePrices } = useFeatureFlags();

  const groupPlans = plans.filter((p) => p.plan_code.startsWith("hifz_group"));
  const individualPlans = plans.filter((p) =>
    p.plan_code.startsWith("hifz_individual"),
  );

  const tiers: PlanTier[] = [
    {
      plans: groupPlans,
      labelAr: "حلقة جماعية",
      labelEn: "Group Hifz",
      descAr: "حفظ منظم في مجموعة صغيرة — تحفيز مستمر وتكاليف معقولة",
      descEn: "Structured memorisation in a small group — accountability and affordability",
      icon: <Users size={22} aria-hidden="true" />,
      features: GROUP_FEATURES,
    },
    {
      plans: individualPlans,
      labelAr: "جلسة فردية",
      labelEn: "Individual Hifz",
      descAr: "اهتمام كامل من المعلم — للمتعلمين الجادين وأصحاب الأهداف الخاصة",
      descEn: "Undivided teacher attention — for serious learners with specific goals",
      icon: <User size={22} aria-hidden="true" />,
      features: INDIVIDUAL_FEATURES,
    },
  ];

  return (
    <div>
      {/* Hero */}
      <section className="islamic-pattern relative overflow-hidden pt-24 pb-16 text-center">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-3xl px-6">
          <nav
            aria-label={t("مسار الصفحة", "Breadcrumb")}
            className="text-xs text-muted-light"
          >
            <Link
              href="/"
              className="text-gold transition-colors hover:text-foreground focus-ring"
            >
              {t("الرئيسية", "Home")}
            </Link>
            <span className="mx-2 text-muted-light" aria-hidden="true">
              /
            </span>
            <span className="text-muted">{t("الأسعار", "Pricing")}</span>
          </nav>
          <h1 className="font-display mt-4 text-4xl font-bold leading-tight sm:text-5xl">
            {t(
              "احفظ القرآن مع معلّم مُجاز — اختر خطتك",
              "Memorize the Quran with a certified teacher — choose your plan",
            )}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            {t(
              "ابدأ رحلتك في حفظ القرآن الكريم — اختر الخطة التي تناسب وقتك وهدفك.",
              "Start your Quran memorisation journey — choose the plan that fits your schedule and goal.",
            )}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle size={14} className="shrink-0 text-success" aria-hidden="true" />
              {t("معلمون حاصلون على الإجازة", "Ijazah-certified teachers")}
            </span>
            <span aria-hidden="true" className="text-muted-light">·</span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle size={14} className="shrink-0 text-success" aria-hidden="true" />
              {t("جلسات فيديو مباشرة", "Live video sessions")}
            </span>
            <span aria-hidden="true" className="text-muted-light">·</span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle size={14} className="shrink-0 text-success" aria-hidden="true" />
              {t("اشتراك شهري بدون عقد", "Monthly — no long-term contract")}
            </span>
          </div>
          <p className="font-display mt-4 text-base text-gold-ink">
            <AyahQuote name="guardianshipOfRevelation" />
          </p>
        </div>
      </section>

      {/* Plans */}
      <section className="py-16" aria-labelledby="pricing-heading">
        <h2 id="pricing-heading" className="sr-only">
          {t("الخطط والأسعار", "Plans and pricing")}
        </h2>
        <div className="mx-auto max-w-5xl space-y-8 px-6">
          {/* Disambiguator ABOVE the cards — the archetypal confused visitor
              arrives from /teachers holding "$20-30/hr" and must meet the
              subscriptions-vs-single-sessions distinction before the prices
              (decision 42; 5/7-persona finding). When the prepaid-hours flag is
              ON (spec 038), swap in disambiguatorWithPrepaid so all three
              pricing systems are named and the visitor is never blindsided. */}
          {!hidePrices && plans.length > 0 && (
            <p className="text-center text-sm text-muted">
              {prepaid
                ? t(
                    PRICING_MODEL.disambiguatorWithPrepaid.ar,
                    PRICING_MODEL.disambiguatorWithPrepaid.en,
                  )
                : t(PRICING_MODEL.disambiguator.ar, PRICING_MODEL.disambiguator.en)}
            </p>
          )}
          {hidePrices ? (
            <div className="glass-card p-12 text-center">
              <p className="text-muted">
                {t(
                  "الأسعار غير متاحة حالياً — تواصل معنا لمعرفة التفاصيل.",
                  "Pricing is currently unavailable — please contact us for details.",
                )}
              </p>
              <Link
                href="/contact"
                className="glass glass-pill mt-4 inline-block px-6 py-3 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background focus-ring"
              >
                {t("تواصل معنا", "Contact us")}
              </Link>
            </div>
          ) : plans.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <p className="text-muted">
                {t(
                  "لا توجد خطط متاحة حالياً.",
                  "No plans available at the moment.",
                )}
              </p>
            </div>
          ) : (
            tiers
              .filter((tier) => tier.plans.length > 0)
              .map((tier) => <Tier key={tier.labelEn} tier={tier} t={t} />)
          )}

          {/* Spec 038 — "Pay as you go" prepaid-hours card. Rendered only when
              the server gate passed a non-null `prepaid` config (flag ON). Sits
              after the subscription tiers so the recurring plans stay primary. */}
          {prepaid && !hidePrices && (
            <PrepaidCard prepaid={prepaid} t={t} paypalEnabled={paypalEnabled} />
          )}

          {!hidePrices && plans.length > 0 && (
            <p className="text-center text-xs text-muted">
              {t(
                `* جميع الخطط شهرية قابلة للإلغاء في أي وقت. الأسعار بالدولار الأمريكي. ${SESSION_DURATION.group.ar}.`,
                `* All plans are monthly and can be cancelled anytime. Prices in USD. ${SESSION_DURATION.group.en}.`,
              )}
            </p>
          )}
        </div>
      </section>

      {/* Family concierge (A6) + institutional row (B3). Single column at
          narrow widths, two columns from md up (T8 a11y/responsive). */}
      <section className="pb-16" aria-labelledby="audiences-heading">
        <div className="mx-auto max-w-5xl px-6">
          <h2 id="audiences-heading" className="sr-only">
            {t("للعائلات والمؤسسات", "For families and institutions")}
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="glass-card flex flex-col p-8">
              <h3 className="font-display text-xl font-bold">
                {t("للعائلات", "For families")}
              </h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">
                {t(FAMILY_POLICY.long.ar, FAMILY_POLICY.long.en)}
              </p>
              <div className="mt-6">
                <Link
                  href="/contact"
                  className="glass-gold glass-pill inline-flex min-h-11 items-center gap-2 px-6 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover focus-ring"
                >
                  {t("تواصل معنا لإعداد عائلتك", "Contact us to set up your family")}
                </Link>
              </div>
            </div>
            <div className="glass-card flex flex-col p-8">
              <h3 className="font-display text-xl font-bold">
                {t("للمؤسسات والمدارس", "For institutions and schools")}
              </h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">
                {t(
                  "برامج جماعية بأسعار خاصة للمدارس والمراكز والجمعيات — نصمم البرنامج والجدول حسب احتياج مؤسستك.",
                  "Group programs with custom pricing for schools, centers, and organizations — we tailor the program and schedule to your institution.",
                )}
              </p>
              <div className="mt-6">
                <Link
                  href="/contact"
                  className="glass-pill inline-flex min-h-11 items-center gap-2 border border-gold/40 px-6 py-2.5 text-sm font-semibold text-gold hover:bg-gold/10 focus-ring"
                >
                  {t("اطلب عرضاً مؤسسياً", "Request an institutional quote")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ — the CANONICAL FAQ surface (G2): policy-driven entries from
          policies.ts first, then the admin-managed site_faqs rows. */}
      <section id="faq" className="pb-16" aria-labelledby="faq-heading">
        <div className="mx-auto max-w-3xl px-6">
          <h2
            id="faq-heading"
            className="font-display mb-6 text-center text-2xl font-bold"
          >
            {t("أسئلة شائعة", "Frequently asked questions")}
          </h2>
          <div className="space-y-3">
            {[
              {
                q: t("كيف يتم اختيار المعلمين؟", "How are teachers selected?"),
                a: t(
                  "كل المعلمين حاصلون على الإجازة، وتتم مراجعة سيرتهم الذاتية قبل اعتمادهم على المنصة.",
                  "All teachers hold an Ijazah, and their credentials are reviewed before they're approved on the platform.",
                ),
              },
              {
                q: t("هل توجد حصة تجريبية؟", "Is there a trial session?"),
                a: t(TRIAL_POLICY.long.ar, TRIAL_POLICY.long.en),
              },
              {
                q: t("كيف ألغي اشتراكي؟", "How do I cancel my subscription?"),
                a: t(
                  "تواصل مع فريق الدعم في أي وقت وسنساعدك في إنهاء الاشتراك.",
                  "Contact our support team anytime and we'll help you cancel your subscription.",
                ),
              },
              {
                q: t("هل يمكن استرجاع المبلغ؟", "Can I get a refund?"),
                a: t(
                  "نراجع طلبات الاسترجاع حسب كل حالة — تواصل مع الدعم وسنبحث الأمر معك.",
                  "Refund requests are reviewed case by case — contact support and we'll look into it with you.",
                ),
              },
              {
                q: t("ماذا لو فاتتني حصة؟", "What if I miss a session?"),
                a: t(ABSENCE_POLICY.long.ar, ABSENCE_POLICY.long.en),
              },
              {
                q: t("هل توجد خصومات للعائلات؟", "Are there family discounts?"),
                a: t(FAMILY_POLICY.long.ar, FAMILY_POLICY.long.en),
              },
              // Spec 038 — only surfaced when the pay-as-you-go option is live
              // (prepaid non-null, same gate as the card), so the FAQ never
              // describes a feature the visitor can't use.
              ...(prepaid
                ? [
                    {
                      q: t(
                        "هل يمكنني شراء ساعات بدل الاشتراك الشهري؟",
                        "Can I buy hours instead of a monthly subscription?",
                      ),
                      a: t(PREPAID_HOURS_POLICY.long.ar, PREPAID_HOURS_POLICY.long.en),
                    },
                  ]
                : []),
              // Admin-managed rows (site_faqs) — same source /contact renders,
              // so admins edit once and both surfaces stay in sync (G2).
              ...faqs.map((f) => ({
                q: t(f.question_ar, f.question_en),
                a: t(f.answer_ar, f.answer_en),
              })),
            ]
              // Policy entries win over an admin row with the same question —
              // prevents duplicate content and duplicate React keys (key=q).
              .filter((item, i, arr) => arr.findIndex((o) => o.q === item.q) === i)
              .map((item) => (
              <details
                key={item.q}
                className="glass-card group p-5 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold focus-ring">
                  <span>{item.q}</span>
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-muted transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <div className="border-t border-white/10">
        <RegisterBanner />
      </div>
    </div>
  );
}
