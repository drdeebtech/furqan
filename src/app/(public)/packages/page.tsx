import type { Metadata } from "next";
import { PackagesContent } from "./packages-content";

export const metadata: Metadata = {
  title: "باقاتنا — أسعار تعلم القرآن",
  description: "باقات أكاديمية فرقان لتعليم القرآن. من 2 جلسات أسبوعياً إلى 5 جلسات. أسعار مناسبة بالدولار والجنيه الإسترليني والريال.",
  alternates: { canonical: "https://furqan.today/packages" },
};

export default function PackagesPage() {
  return <PackagesContent />;
}
