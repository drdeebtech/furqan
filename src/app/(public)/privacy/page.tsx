import type { Metadata } from "next";
import PrivacyContent from "./privacy-content";

export const metadata: Metadata = {
  title: "سياسة الخصوصية · Privacy Policy",
  description:
    "كيف تجمع أكاديمية فرقان بياناتك وتستخدمها وتحميها. How FURQAN Academy collects, uses, and protects your data.",
  alternates: { canonical: "https://furqan.today/privacy" },
};

export default function PrivacyPage() {
  return <PrivacyContent />;
}
