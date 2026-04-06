import type { Metadata } from "next";
import { ContactContent } from "./contact-content";
import { BreadcrumbSchema } from "@/components/seo/structured-data";

export const metadata: Metadata = {
  title: "اتصل بنا",
  description: "تواصل مع أكاديمية فرقان عبر واتساب أو البريد الإلكتروني. نرد خلال 24 ساعة. سجّل الآن وابدأ.",
  alternates: { canonical: "https://furqan.today/contact" },
};

export default function ContactPage() {
  return (
    <>
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://furqan.today" },
        { name: "اتصل بنا", url: "https://furqan.today/contact" },
      ]} />
      <ContactContent />
    </>
  );
}
