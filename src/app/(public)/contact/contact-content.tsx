"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { FreeTrialBanner } from "@/components/public/free-trial-banner";
import { ContactForm } from "./contact-form";
import { FAQ } from "./faq";

export function ContactContent() {
  const { t } = useLang();

  return (
    <div>
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted"><Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("اتصل بنا", "Contact")}</p>
        <h1 className="font-display mt-4 text-5xl font-bold">{t("اتصل بنا", "Contact Us")}</h1>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-7xl gap-12 px-6 md:flex">
          <div className="mb-12 md:mb-0 md:w-2/5">
            <p className="text-sm font-medium tracking-widest text-gold">❖ {t("تواصل معنا", "Get in Touch")}</p>
            <h2 className="font-display mt-3 text-3xl font-bold">{t("نسعد بخدمتك", "We'd Love to Hear from You")}</h2>

            <div className="mt-8 space-y-6">
              <div>
                <p className="text-sm font-bold">{t("واتساب UK", "WhatsApp UK")}</p>
                <a href="https://wa.me/447400000000" className="text-sm text-gold hover:text-gold-light">+44 74 0000 0000</a>
                <p className="text-xs text-muted">{t("متاح ٧ أيام · ٩ص - ١١م", "Available 7 days · 9am - 11pm")}</p>
              </div>
              <div>
                <p className="text-sm font-bold">{t("واتساب US", "WhatsApp US")}</p>
                <a href="https://wa.me/12125550000" className="text-sm text-gold hover:text-gold-light">+1 212 555 0000</a>
              </div>
              <div>
                <p className="text-sm font-bold">{t("البريد الإلكتروني", "Email")}</p>
                <p className="text-sm text-muted">info@furqan.academy</p>
              </div>
              <div>
                <p className="text-sm font-bold">{t("ساعات العمل", "Working Hours")}</p>
                <p className="text-xs text-muted">{t("الإثنين - السبت: ٦ص - ١١م (بتوقيت السعودية)", "Mon - Sat: 6am - 11pm (KSA Time)")}</p>
              </div>
            </div>

            <a
              href="https://wa.me/447400000000"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 flex items-center justify-center gap-2 rounded-xl bg-green-600 py-4 font-medium text-white transition-colors hover:bg-green-700"
            >
              {t("تحدث معنا على واتساب الآن", "Chat with us on WhatsApp")}
            </a>
          </div>

          <div className="flex-1">
            <ContactForm />
          </div>
        </div>
      </section>

      <div className="border-t border-card-border"><FAQ /></div>
      <FreeTrialBanner />
    </div>
  );
}
