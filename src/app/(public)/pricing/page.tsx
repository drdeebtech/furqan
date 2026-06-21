import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BreadcrumbSchema } from "@/components/seo/structured-data";
import { BASE_URL } from "@/lib/constants";
import { logError } from "@/lib/logger";
import { PricingContent } from "./content";

export const metadata: Metadata = {
  title: "الأسعار — اشتراكات حفظ القرآن",
  description:
    "خطط اشتراك شهرية لحفظ القرآن الكريم: حلقات جماعية وجلسات فردية. اختر الخطة المناسبة لك وابدأ رحلتك اليوم.",
  alternates: { canonical: `${BASE_URL}/pricing` },
};

export default async function PricingPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
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
    >();

  if (error) {
    logError("pricing: subscription_plans fetch failed", error, { tag: "pricing" });
  }

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "الرئيسية", url: BASE_URL },
          { name: "الأسعار", url: `${BASE_URL}/pricing` },
        ]}
      />
      <PricingContent plans={data ?? []} />
    </>
  );
}
