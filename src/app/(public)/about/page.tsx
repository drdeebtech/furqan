import type { Metadata } from "next";
import { AboutContent } from "./content";

export const metadata: Metadata = {
  title: "من نحن",
  description: "تعرف على أكاديمية فرقان — فريق من المعلمين المعتمدين المتخصصين في تعليم القرآن الكريم عبر الإنترنت.",
  alternates: { canonical: "https://furqan.today/about" },
};

export default function AboutPage() {
  return <AboutContent />;
}
