import type { Metadata } from "next";
import PrivacyContent from "./privacy-content";
import { getLegalDocument } from "@/lib/site-content/legal";

export const metadata: Metadata = {
  title: "سياسة الخصوصية · Privacy Policy",
  description:
    "كيف تجمع أكاديمية فرقان بياناتك وتستخدمها وتحميها. How FURQAN Academy collects, uses, and protects your data.",
  alternates: { canonical: "https://www.furqan.today/privacy" },
};

export default async function PrivacyPage() {
  const doc = await getLegalDocument("privacy");
  const override = doc && (doc.body_ar || doc.body_en)
    ? { bodyAr: doc.body_ar, bodyEn: doc.body_en, updatedAt: doc.updated_at }
    : null;
  return <PrivacyContent override={override} />;
}
