import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BreadcrumbSchema } from "@/components/seo/structured-data";
import { PricingContent } from "./content";

export const metadata: Metadata = {
  title: "الأسعار — اشتراكات حفظ القرآن",
  description:
    "خطط اشتراك شهرية لحفظ القرآن الكريم: حلقات جماعية وجلسات فردية. اختر الخطة المناسبة لك وابدأ رحلتك اليوم.",
  alternates: { canonical: "https://www.furqan.today/pricing" },
};

export default async function PricingPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("subscription_plans")
    .select(
      "id, plan_code, name, monthly_credit_count, price_cents, currency",
    )
    .eq("is_active", true)
    .order("price_cents", { ascending: true })
    .returns<
      {
        id: string;
        plan_code: string;
        name: string;
        monthly_credit_count: number;
        price_cents: number;
        currency: string;
      }[]
    >();

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "الرئيسية", url: "https://www.furqan.today" },
          { name: "الأسعار", url: "https://www.furqan.today/pricing" },
        ]}
      />
      <PricingContent plans={data ?? []} />
    </>
  );
}
