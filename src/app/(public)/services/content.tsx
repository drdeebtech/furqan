"use client";

import Image from "next/image";
import Link from "next/link";
import { CheckCircle, Inbox } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/register-banner";

interface Service {
  id: string;
  title: string;
  title_ar: string | null;
  description: string;
  description_ar: string | null;
  features: string[];
  features_ar: string[];
  icon: string | null;
  image_url: string | null;
}

export function ServicesContent({ services }: { services: Service[] }) {
  const { t } = useLang();

  return (
    <div>
      <section className="islamic-pattern relative overflow-hidden pt-24 pb-16 text-center">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-6">
          <nav aria-label={t("مسار الصفحة", "Breadcrumb")} className="text-xs text-muted-light">
            <Link href="/" className="text-gold transition-colors hover:text-gold-light focus-ring">{t("الرئيسية", "Home")}</Link>
            <span className="mx-2 text-muted-light" aria-hidden="true">/</span>
            <span className="text-muted">{t("خدماتنا", "Services")}</span>
          </nav>
          <h1 className="font-display mt-4 text-4xl font-bold leading-tight sm:text-5xl">{t("خدماتنا", "Our Services")}</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            {t(
              "حفظ، تجويد، تلاوة، قراءات، تفسير — مسارات واضحة لكل مرحلة من رحلتك.",
              "Hifz, Tajweed, recitation, Qira'at, Tafsir — clear pathways for every stage of your journey.",
            )}
          </p>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-5xl space-y-16 px-6">
          {services.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <Inbox size={32} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">{t("لا توجد خدمات حالياً", "No services available")}</p>
            </div>
          ) : (
            services.map((s, i) => {
              const title = t(s.title_ar ?? s.title, s.title);
              const desc = t(s.description_ar ?? s.description, s.description);
              const featuresAr = s.features_ar ?? [];
              const features = s.features ?? [];
              const feats = t(
                (featuresAr.length > 0 ? featuresAr : features).join("|||"),
                features.join("|||"),
              ).split("|||");

              return (
                <div key={s.id} className={`gap-12 md:flex ${i % 2 === 1 ? "md:flex-row-reverse" : ""}`}>
                  <div className="flex-1">
                    <p className="text-sm font-medium tracking-widest text-gold">❖ {s.title}</p>
                    <h2 className="font-display mt-2 text-3xl font-bold leading-tight">{title}</h2>
                    <p className="mt-4 text-sm leading-relaxed text-muted">{desc}</p>
                    <ul className="mt-6 space-y-2">
                      {feats.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <CheckCircle size={16} className="mt-0.5 shrink-0 text-gold" />
                          <span className="text-muted">{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Link href="/contact" className="glass glass-pill mt-6 inline-block px-5 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
                      {t("سجّل وابدأ التعلم", "Register & Start Learning")}
                    </Link>
                  </div>
                  <div className="mt-8 flex-1 md:mt-0">
                    <div className="glass-card flex h-full items-center justify-center p-12">
                      {s.image_url ? (
                        // height auto + max-h-48 keeps aspect ratio when the
                        // viewport-scaled width changes — fixes the dev-log
                        // "width or height modified, but not the other"
                        // warning. priority on the first card so the LCP
                        // signal Next detects gets eager-loaded.
                        <Image
                          src={s.image_url}
                          alt={title}
                          width={384}
                          height={192}
                          sizes="(max-width: 768px) 100vw, 384px"
                          className="max-h-48 rounded-xl object-contain"
                          style={{ height: "auto", width: "auto" }}
                          priority={i === 0}
                        />
                      ) : (
                        <span className="font-display text-6xl text-gold/10">
                          {(s.title_ar ?? s.title).charAt(0)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <div className="border-t border-white/10"><Testimonials /></div>
      <RegisterBanner />
    </div>
  );
}
