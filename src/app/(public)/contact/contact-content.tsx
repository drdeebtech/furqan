"use client";

import Link from "next/link";
import { useLang } from "@/lib/i18n/context";
import { CONTACT } from "@/lib/contact";
import { RegisterBanner } from "@/components/public/register-banner";
import { ContactForm } from "./contact-form";
import { FAQ } from "./faq";

export function ContactContent() {
  const { t } = useLang();

  return (
    <div>
      <section className="glass-card border-b border-white/10 py-20 text-center">
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
                <p className="text-sm font-bold">{t("واتساب", "WhatsApp")}</p>
                <a href={CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-gold hover:text-gold-light">{CONTACT.flag} {CONTACT.whatsapp}</a>
                <p className="text-xs text-muted">{t(CONTACT.availability.ar, CONTACT.availability.en)}</p>
              </div>
              <div>
                <p className="text-sm font-bold">{t("البريد الإلكتروني", "Email")}</p>
                <a href={CONTACT.emailUrl} className="text-sm text-gold hover:text-gold-light">{CONTACT.email}</a>
              </div>
            </div>

            <a
              href={CONTACT.whatsappUrlWithMessage}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 flex items-center justify-center gap-2 rounded-xl bg-green-600 py-4 font-medium text-white transition-colors hover:bg-green-700"
            >
              {t(`تحدث معنا على واتساب · ${CONTACT.whatsapp}`, `Chat on WhatsApp · ${CONTACT.whatsapp}`)}
            </a>
          </div>

          <div className="flex-1">
            <ContactForm />
          </div>
        </div>
      </section>

      <div className="border-t border-white/10"><FAQ /></div>
      <RegisterBanner />
    </div>
  );
}
