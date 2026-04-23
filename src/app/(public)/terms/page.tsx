import type { Metadata } from "next";
import TermsContent from "./terms-content";

export const metadata: Metadata = {
  title: "شروط الاستخدام · Terms of Service",
  description:
    "شروط استخدام أكاديمية فرقان لتعلم القرآن الكريم. Terms of service for FURQAN Quran Academy.",
  alternates: { canonical: "https://furqan.today/terms" },
};

export default function TermsPage() {
  return <TermsContent />;
}
