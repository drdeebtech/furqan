import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BreadcrumbSchema } from "@/components/seo/structured-data";
import { BASE_URL } from "@/lib/constants";
import { logError } from "@/lib/logger";
import { PricingContent, type Faq } from "./content";

export const metadata: Metadata = {
  title: "الأسعار — اشتراكات حفظ القرآن",
  description:
    "خطط اشتراك شهرية لحفظ القرآن الكريم: حلقات جماعية وجلسات فردية. اختر الخطة المناسبة لك وابدأ رحلتك اليوم.",
  alternates: { canonical: `${BASE_URL}/pricing` },
};

export default async function PricingPage() {
  const supabase = await createClient();

  // G2: /pricing is the CANONICAL FAQ surface — policy-driven entries from
  // src/lib/copy/policies.ts plus the admin-managed site_faqs rows (the same
  // rows /contact renders), so admin edits appear here with no code change.
  const [plansRes, faqsRes] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select("id, plan_code, name, monthly_credit_count, price_cents")
      .eq("is_active", true)
      .order("price_cents", { ascending: true })
      .returns<
        {
          id: string;
          plan_code: string;
          name: string;
          monthly_credit_count: number;
          price_cents: number;
        }[]
      >(),
    supabase
      .from("site_faqs")
      .select("id, question_ar, question_en, answer_ar, answer_en")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .returns<Faq[]>(),
  ]);

  const { data, error } = plansRes;
  if (error) {
    logError("pricing: subscription_plans fetch failed", error, { tag: "pricing" });
  }
  if (faqsRes.error) {
    // Fail-soft: the policy-driven FAQ entries still render without DB rows.
    logError("pricing: site_faqs fetch failed", faqsRes.error, { tag: "pricing" });
  }
  // Explicit error branch (not `?? []`) so the silent-fail tripwire sees the
  // error is handled above, not defaulted away.
  const faqRows = faqsRes.error || !faqsRes.data ? [] : faqsRes.data;

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "الرئيسية", url: BASE_URL },
          { name: "الأسعار", url: `${BASE_URL}/pricing` },
        ]}
      />
      <PricingContent plans={data ?? []} faqs={faqRows} />
    </>
  );
}
