import type { Metadata } from "next";
import { AboutContent } from "./content";
import { BreadcrumbSchema } from "@/components/seo/structured-data";

export const metadata: Metadata = {
  title: "من نحن",
  description: "تعرف على أكاديمية فرقان — فريق من المعلمين المعتمدين المتخصصين في تعليم القرآن الكريم عبر الإنترنت.",
  alternates: { canonical: "https://furqan.today/about" },
};

export default function AboutPage() {
  return (
    <>
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://furqan.today" },
        { name: "من نحن", url: "https://furqan.today/about" },
      ]} />
      <AboutContent />
    </>
  );
}
