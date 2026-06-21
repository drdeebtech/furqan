import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ArrowLeft, CheckCircle, BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getActivePlanByCode } from "@/lib/domains/billing";
import { getT } from "@/lib/i18n/server";
import { CheckoutButton } from "./checkout-button";

export const metadata: Metadata = {
  title: "تأكيد الاشتراك · Subscribe",
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ plan?: string }>;
}

export default async function SubscribePage({ searchParams }: Props) {
  const { plan: planCode } = await searchParams;
  const { t, dir } = await getT();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    const redirectParam = planCode
      ? `?redirect=/subscribe?plan=${encodeURIComponent(planCode)}`
      : "";
    redirect(`/login${redirectParam}`);
  }

  if (!planCode) {
    redirect("/pricing");
  }

  const plan = await getActivePlanByCode(supabase, planCode);

  const backArrow = dir === "rtl" ? <ArrowLeft size={14} aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />;

  return (
    <div dir={dir} className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-md space-y-6">
        {/* Back link */}
        <Link
          href="/pricing"
          className="inline-flex items-center gap-1.5 text-sm text-gold transition-colors hover:text-gold-light focus-ring rounded-lg"
        >
          {backArrow}
          {t("العودة للأسعار", "Back to pricing")}
        </Link>

        {/* Plan card */}
        <div className="rounded-2xl glass-card p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold/10 text-gold">
              <BookOpen size={22} aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted">
                {t("خطة الاشتراك", "Subscription plan")}
              </p>
              <h1 className="font-display text-xl font-bold leading-tight">
                {plan ? plan.name : t("الخطة غير موجودة", "Plan not found")}
              </h1>
            </div>
          </div>

          {plan ? (
            <>
              {/* Price */}
              <div className="flex items-baseline gap-1">
                <span className="font-display text-4xl font-bold text-gold" dir="ltr">
                  ${(plan.priceCents / 100).toFixed(0)}
                </span>
                <span className="text-sm text-muted">/{t("شهر", "month")}</span>
              </div>

              {/* Features */}
              <ul className="space-y-2">
                <li className="flex items-start gap-2 text-sm">
                  <CheckCircle size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                  <span className="text-muted">
                    {plan.monthlyCreditCount} {t("جلسة/شهر", "sessions / month")}
                  </span>
                </li>
                <li className="flex items-start gap-2 text-sm">
                  <CheckCircle size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                  <span className="text-muted">{t("مع معلمين معتمدين", "With certified teachers")}</span>
                </li>
                <li className="flex items-start gap-2 text-sm">
                  <CheckCircle size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                  <span className="text-muted">{t("يمكن الإلغاء في أي وقت", "Cancel anytime")}</span>
                </li>
              </ul>

              <div className="h-px bg-white/10" />

              <CheckoutButton planCode={plan.planCode} />

              <p className="text-center text-xs text-muted">
                {t(
                  "ستُحوَّل إلى صفحة Stripe الآمنة لإتمام الدفع",
                  "You will be redirected to a secure Stripe page to complete payment",
                )}
              </p>
            </>
          ) : (
            <div className="rounded-xl glass-danger p-4 text-sm text-error">
              {t(
                "هذه الخطة غير متاحة حالياً — اختر خطة أخرى من صفحة الأسعار.",
                "This plan is not available — please choose another plan from the pricing page.",
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
