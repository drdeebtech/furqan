import type { Metadata } from "next";
import Link from "next/link";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";
import { ContactForm } from "./contact-form";
import { FAQ } from "./faq";

export const metadata: Metadata = { title: "اتصل بنا" };

export default function ContactPage() {
  return (
    <div dir="rtl">
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted">
          <Link href="/" className="text-gold hover:text-gold-light">الرئيسية</Link> / اتصل بنا
        </p>
        <h1 className="font-display mt-4 text-5xl font-bold">اتصل بنا</h1>
        <p className="mt-2 text-muted">Contact Us</p>
      </section>

      {/* Two columns */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl gap-12 px-6 md:flex">
          {/* Contact info */}
          <div className="mb-12 md:mb-0 md:w-2/5">
            <p className="text-sm font-medium tracking-widest text-gold">❖ تواصل معنا</p>
            <h2 className="font-display mt-3 text-3xl font-bold">نسعد بخدمتك</h2>

            <div className="mt-8 space-y-6">
              <div>
                <p className="text-sm font-bold">واتساب UK</p>
                <a href="https://wa.me/447400000000" className="text-sm text-gold hover:text-gold-light">+44 74 0000 0000</a>
                <p className="text-xs text-muted">متاح ٧ أيام · ٩ص - ١١م</p>
              </div>
              <div>
                <p className="text-sm font-bold">واتساب US</p>
                <a href="https://wa.me/12125550000" className="text-sm text-gold hover:text-gold-light">+1 212 555 0000</a>
              </div>
              <div>
                <p className="text-sm font-bold">البريد الإلكتروني</p>
                <p className="text-sm text-muted">info@furqan.academy</p>
              </div>
              <div>
                <p className="text-sm font-bold">ساعات العمل</p>
                <p className="text-xs text-muted">الإثنين - السبت: ٦ص - ١١م (بتوقيت السعودية)</p>
                <p className="text-xs text-muted">Mon - Sat: 6am - 11pm (KSA Time)</p>
              </div>
            </div>

            <a
              href="https://wa.me/447400000000?text=%D8%A3%D8%B1%D9%8A%D8%AF%20%D8%AC%D9%84%D8%B3%D8%A9%20%D8%AA%D8%AC%D8%B1%D9%8A%D8%A8%D9%8A%D8%A9%20%D9%85%D8%AC%D8%A7%D9%86%D9%8A%D8%A9"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 flex items-center justify-center gap-2 rounded-xl bg-green-600 py-4 font-medium text-white transition-colors hover:bg-green-700"
            >
              تحدث معنا على واتساب الآن
            </a>
          </div>

          {/* Form */}
          <div className="flex-1">
            <ContactForm />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <div className="border-t border-card-border">
        <FAQ />
      </div>

      <FreeTrialBanner />
    </div>
  );
}
