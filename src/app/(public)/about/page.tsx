import type { Metadata } from "next";
import { AboutContent } from "./content";
import { BreadcrumbSchema } from "@/components/seo/structured-data";
import { getFeaturesBySlot } from "@/lib/site-content/queries";

export const metadata: Metadata = {
  title: "من نحن",
  description: "تعرف على أكاديمية فرقان — فريق من المعلمين المعتمدين المتخصصين في تعليم القرآن الكريم عبر الإنترنت.",
  alternates: { canonical: "https://furqan.today/about" },
};

// ISR — about_values lives in site_features. Admin edits in /admin/content
// already call revalidatePath("/about") so changes propagate within seconds.
// The 10-min ceiling matches the homepage; "about" content rarely changes,
// so this is conservative.
export const revalidate = 600;

export default async function AboutPage() {
  const values = await getFeaturesBySlot("about_values");
  return (
    <>
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://furqan.today" },
        { name: "من نحن", url: "https://furqan.today/about" },
      ]} />
      <AboutContent values={values} />
    </>
  );
}
