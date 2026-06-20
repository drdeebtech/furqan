"use client";

import Link from "next/link";
import { CheckCircle, Users, User } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import { RegisterBanner } from "@/components/public/register-banner";

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
  highlight,
}: {
  plan: Plan;
  t: (ar: string, en: string) => string;
  highlight: boolean;
}) {
  return (
    // Wrapper provides positioning context for the badge WITHOUT overflow:hidden,
    // so the badge isn't clipped by glass-card's overflow:hidden backdrop-filter boundary.
    <div className={`relative ${highlight ? "pt-3" : ""}`}>
      {highlight && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-muted/40 bg-surface px-3 py-0.5 text-xs font-semibold text-foreground">
          {t("الأكثر طلباً", "Most popular")}
        </span>
      )}
      <div
        className={`glass-card flex flex-col gap-4 p-6 transition-shadow duration-200 hover:shadow-gold/10 hover:shadow-lg h-full ${
          highlight ? "border-gold/40 ring-1 ring-gold/30" : ""
        }`}
      >
        <div>
          <p className="text-xs font-medium tracking-widest text-muted uppercase">
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
  const middle = Math.floor(tier.plans.length / 2);

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
        {tier.plans.map((plan, i) => (
          <PlanCard key={plan.id} plan={plan} t={t} highlight={i === middle} />
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

export function PricingContent({ plans }: { plans: Plan[] }) {
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
              className="text-gold transition-colors hover:text-gold-light focus-ring"
            >
              {t("الرئيسية", "Home")}
            </Link>
            <span className="mx-2 text-muted-light" aria-hidden="true">
              /
            </span>
            <span className="text-muted">{t("الأسعار", "Pricing")}</span>
          </nav>
          <h1 className="font-display mt-4 text-4xl font-bold leading-tight sm:text-5xl">
            {t("خطط الاشتراك", "Subscription Plans")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            {t(
              "ابدأ رحلتك في حفظ القرآن الكريم — اختر الخطة التي تناسب وقتك وهدفك.",
              "Start your Quran memorisation journey — choose the plan that fits your schedule and goal.",
            )}
          </p>
          <p className="font-display mt-4 text-base text-gold/70">
            ﴿ إِنَّا نَحْنُ نَزَّلْنَا الذِّكْرَ وَإِنَّا لَهُ لَحَافِظُونَ ﴾
          </p>
        </div>
      </section>

      {/* Plans */}
      <section className="py-16" aria-labelledby="pricing-heading">
        <h2 id="pricing-heading" className="sr-only">
          {t("الخطط والأسعار", "Plans and pricing")}
        </h2>
        <div className="mx-auto max-w-5xl space-y-8 px-6">
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

          {!hidePrices && plans.length > 0 && (
            <p className="text-center text-xs text-muted">
              {t(
                "* جميع الخطط شهرية قابلة للإلغاء في أي وقت. الأسعار بالدولار الأمريكي.",
                "* All plans are monthly and can be cancelled anytime. Prices in USD.",
              )}
            </p>
          )}
        </div>
      </section>

      <div className="border-t border-white/10">
        <RegisterBanner />
      </div>
    </div>
  );
}
