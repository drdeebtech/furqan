import type { Metadata } from "next";
import CookiesContent from "./cookies-content";

export const metadata: Metadata = {
  title: "سياسة الكوكيز · Cookie Policy",
  description:
    "كيفية استخدام ملفات تعريف الارتباط في أكاديمية فرقان. How FURQAN Academy uses cookies.",
  alternates: { canonical: "https://furqan.today/cookies" },
};

export default function CookiesPage() {
  return <CookiesContent />;
}
