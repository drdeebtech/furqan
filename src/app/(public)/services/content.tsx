"use client";

import Link from "next/link";
import { CheckCircle, Inbox } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { Testimonials } from "@/components/public/testimonials";
import { RegisterBanner } from "@/components/public/free-trial-banner";

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
      <section className="border-b border-card-border bg-card py-20 text-center">
        <p className="text-sm text-muted"><Link href="/" className="text-gold hover:text-gold-light">{t("الرئيسية", "Home")}</Link> / {t("خدماتنا", "Services")}</p>
        <h1 className="font-display mt-4 text-5xl font-bold">{t("خدماتنا", "Our Services")}</h1>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-5xl space-y-16 px-6">
          {services.length === 0 ? (
            <div className="rounded-2xl border border-card-border bg-card p-12 text-center">
              <Inbox size={32} className="mx-auto mb-3 text-muted" />
              <p className="text-muted">{t("لا توجد خدمات حالياً", "No services available")}</p>
            </div>
          ) : (
            services.map((s, i) => {
              const title = t(s.title_ar ?? s.title, s.title);
              const desc = t(s.description_ar ?? s.description, s.description);
              const feats = t(
                (s.features_ar.length > 0 ? s.features_ar : s.features).join("|||"),
                s.features.join("|||"),
              ).split("|||");

              return (
                <div key={s.id} className={`gap-12 md:flex ${i % 2 === 1 ? "md:flex-row-reverse" : ""}`}>
                  <div className="flex-1">
                    <p className="text-sm font-medium tracking-widest text-gold">❖ {s.title}</p>
                    <h2 className="font-display mt-2 text-3xl font-bold">{title}</h2>
                    <p className="mt-4 text-sm leading-relaxed text-muted">{desc}</p>
                    <ul className="mt-6 space-y-2">
                      {feats.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <CheckCircle size={16} className="mt-0.5 shrink-0 text-gold" />
                          <span className="text-muted">{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Link href="/contact" className="mt-6 inline-block rounded border border-gold bg-gold/10 px-5 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold hover:text-background">
                      {t("سجّل وابدأ التعلم", "Register & Start Learning")}
                    </Link>
                  </div>
                  <div className="mt-8 flex-1 md:mt-0">
                    <div className="flex h-full items-center justify-center rounded-2xl border border-card-border bg-card p-12">
                      {s.image_url ? (
                        <img src={s.image_url} alt={title} className="max-h-48 rounded-xl object-contain" />
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

      <div className="border-t border-card-border"><Testimonials /></div>
      <RegisterBanner />
    </div>
  );
}
