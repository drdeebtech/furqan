import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { Package } from "@/types/database";
import { PackagesContent } from "./packages-content";
import { BreadcrumbSchema } from "@/components/seo/structured-data";
import { isFeatureEnabled } from "@/lib/settings";

export const metadata: Metadata = {
  title: "باقاتنا — أسعار تعلم القرآن",
  description: "باقات أكاديمية فرقان لتعليم القرآن. من 2 جلسات أسبوعياً إلى 5 جلسات. أسعار مناسبة بالدولار والجنيه الإسترليني والريال.",
  alternates: { canonical: "https://www.furqan.today/packages" },
};

// Dynamic — page contents depend on the signed-in user (PayPal Smart
// Buttons render only for authenticated students; anonymous visitors
// see the /contact CTA). ISR (`revalidate = N`) cached the anonymous
// version, so signed-in students kept seeing "Book Now" instead of
// PayPal. Force-dynamic so every request reads cookies + flag fresh.
// Performance impact: ~100-200ms per request (Supabase round-trips);
// acceptable for a low-traffic public catalog.
export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const supabase = await createClient();
  // Read the PayPal flag uncached — getSettings() has a 1-hour
  // unstable_cache TTL and admin SQL updates don't invalidate it.
  // isFeatureEnabled() hits the DB directly each request, which is fine
  // here since the page is already force-dynamic.
  const [{ data: packages }, { data: { user } }, paypalEnabled] = await Promise.all([
    supabase
      .from("packages")
      .select("*")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .returns<Package[]>(),
    supabase.auth.getUser(),
    isFeatureEnabled("paypal_purchase_enabled"),
  ]);

  return (
    <>
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://www.furqan.today" },
        { name: "باقاتنا", url: "https://www.furqan.today/packages" },
      ]} />
      <PackagesContent
        packages={packages ?? []}
        paypalEnabled={paypalEnabled}
        isAuthenticated={!!user}
      />
    </>
  );
}
