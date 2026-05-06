import type { Metadata } from "next";
import HomeContent from "./home-content";
import { getFeaturesBySlot } from "@/lib/site-content/queries";

export const metadata: Metadata = {
  title: "فرقان — تعلم القرآن الكريم مع معلمين معتمدين",
  description: "أكاديمية فرقان لتعليم القرآن عبر الإنترنت. حفظ وتجويد وتلاوة مع معلمين حاصلين على الإجازة. سجّل الآن وابدأ.",
  alternates: { canonical: "https://www.furqan.today" },
};

// ISR — homepage content lives in site_features (5 slots fetched in parallel
// below). Admin edits in /admin/content already call revalidatePath("/")
// so changes propagate within seconds; the 10-minute ceiling is the
// worst-case staleness when the cache hasn't been touched. Without this
// every visit was an authenticated Supabase round-trip — turns into a
// CDN edge response after caching.
export const revalidate = 600;

export default async function HomePage() {
  const [howItWorks, whyUs, subjects, trustStrip, packagePreview] = await Promise.all([
    getFeaturesBySlot("home_how_it_works"),
    getFeaturesBySlot("home_why_us"),
    getFeaturesBySlot("home_subjects"),
    getFeaturesBySlot("home_trust_strip"),
    getFeaturesBySlot("home_package_preview"),
  ]);

  return (
    <HomeContent
      howItWorks={howItWorks}
      whyUs={whyUs}
      subjects={subjects}
      trustStrip={trustStrip}
      packagePreview={packagePreview}
    />
  );
}
