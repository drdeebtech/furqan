import type { Metadata } from "next";
import TermsContent from "./terms-content";
import { getLegalDocument } from "@/lib/site-content/legal";

export const metadata: Metadata = {
  title: "شروط الاستخدام · Terms of Service",
  description:
    "شروط استخدام أكاديمية فرقان لتعلم القرآن الكريم. Terms of service for FURQAN Quran Academy.",
  alternates: { canonical: "https://furqan.today/terms" },
};

export default async function TermsPage() {
  const doc = await getLegalDocument("terms");
  const override = doc && (doc.body_ar || doc.body_en)
    ? { bodyAr: doc.body_ar, bodyEn: doc.body_en, updatedAt: doc.updated_at }
    : null;
  return <TermsContent override={override} />;
}
