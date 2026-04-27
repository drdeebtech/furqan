import type { Metadata } from "next";
import { AboutContent } from "./content";
import { BreadcrumbSchema } from "@/components/seo/structured-data";
import { getFeaturesBySlot } from "@/lib/site-content/queries";

export const metadata: Metadata = {
  title: "من نحن",
  description: "تعرف على أكاديمية فرقان — فريق من المعلمين المعتمدين المتخصصين في تعليم القرآن الكريم عبر الإنترنت.",
  alternates: { canonical: "https://furqan.today/about" },
};

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
