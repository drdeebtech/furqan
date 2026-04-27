import type { Metadata } from "next";
import { ContactContent } from "./contact-content";
import { FAQ } from "./faq";
import { BreadcrumbSchema } from "@/components/seo/structured-data";

export const metadata: Metadata = {
  title: "اتصل بنا",
  description: "تواصل مع أكاديمية فرقان عبر واتساب أو البريد الإلكتروني. نرد خلال 24 ساعة. سجّل الآن وابدأ.",
  alternates: { canonical: "https://furqan.today/contact" },
};

export default async function ContactPage() {
  // FAQ is an async server component (reads from site_faqs). Render it here
  // and pass the result through as a slot so ContactContent can stay client.
  const faqSlot = await FAQ();
  return (
    <>
      <BreadcrumbSchema items={[
        { name: "الرئيسية", url: "https://furqan.today" },
        { name: "اتصل بنا", url: "https://furqan.today/contact" },
      ]} />
      <ContactContent faqSlot={faqSlot} />
    </>
  );
}
