"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { GraduationCap, Play, Star, Users } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useInView } from "@/lib/hooks/use-in-view";
import { RegisterBanner } from "@/components/public/register-banner";
import { resolveIcon } from "@/lib/site-content/icon-map";
import type { SiteFeature, SubjectMeta } from "@/lib/site-content/types";

/** Section wrapper that fades + slides 16px on viewport entry (one-shot).
 *  Reduced-motion users see content statically per the CSS guard. */
function RevealSection({ className = "", children }: { className?: string; children: ReactNode }) {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section ref={ref} data-in-view={inView} className={`scroll-reveal ${className}`}>
      {children}
    </section>
  );
}

const Testimonials = dynamic(
  () => import("@/components/public/testimonials").then((m) => m.Testimonials),
);

interface Props {
  howItWorks: SiteFeature[];
  whyUs: SiteFeature[];
  subjects: SiteFeature[];
  trustStrip: SiteFeature[];
}

export default function HomePage({
  howItWorks,
  whyUs,
  subjects,
  trustStrip,
}: Props) {
  const { t } = useLang();

  return (
    <div>
      {/* ══════════════════════════════════════════
          HERO — Islamic pattern, ornament-free
          ══════════════════════════════════════════ */}
      <section className="islamic-pattern relative min-h-[85vh] overflow-hidden pt-28 pb-24">
        {/* Soft top-to-bottom fade only — no radial glow */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" />

        <div className="relative mx-auto max-w-5xl px-6">
          <div className="text-center">
            {/* Badge */}
            <div className="glass glass-pill mb-8 inline-flex items-center gap-2 px-4 py-1.5 text-xs animate-fade-up motion-reduce:animate-none">
              <span className="text-muted">{t("أكاديمية القرآن الكريم عبر الإنترنت", "Online Quran Learning Academy")}</span>
            </div>

            {/* Logo */}
            <div className="mb-6 flex justify-center animate-fade-up animate-delay-1 motion-reduce:animate-none">
              <Image src="/logo-192.png" alt="فرقان" width={80} height={80} className="rounded-full border-2 border-gold/30" priority />
            </div>

            {/* Heading */}
            <h1 className="font-display text-4xl font-bold leading-[1.3] md:text-6xl md:leading-[1.2] lg:text-7xl animate-fade-up animate-delay-2 motion-reduce:animate-none">
              {t("تعلّم", "Learn")}{" "}
              <span className="text-gold">{t("القرآن", "Quran")}</span>
              <br />
              {t("مع أمهر المعلمين", "With Expert Teachers")}
            </h1>

            {/* Subtitle */}
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-muted md:text-xl animate-fade-up animate-delay-3 motion-reduce:animate-none">
              {t(
                "معلمون حاصلون على الإجازة · جلسات فيديو مباشرة · جدول يناسبك · من أي مكان في العالم",
                "Certified teachers with Ijazah · Live video sessions · Flexible schedule · From anywhere in the world",
              )}
            </p>

            {/* CTA buttons — primary filled, secondary text link */}
            <div className="mt-10 flex w-full flex-col items-center gap-4 px-4 sm:w-auto sm:flex-row sm:justify-center sm:px-0 animate-fade-up animate-delay-4 motion-reduce:animate-none">
              <Link
                href="/register"
                className="glass-gold glass-pill animate-pulse-slow flex w-full items-center justify-center gap-2 px-10 py-4 text-lg font-semibold tracking-tight transition-all duration-200 hover:bg-gold-hover motion-reduce:animate-none sm:w-auto"
              >
                <Play size={18} aria-hidden="true" />
                {t("سجّل الآن", "Register Now")}
              </Link>
              <Link
                href="/services"
                className="inline-flex items-center gap-1.5 text-base text-muted transition-colors hover:text-gold sm:w-auto"
              >
                {t("تعرف على خدماتنا", "Explore our services")}
                <span aria-hidden>→</span>
              </Link>
            </div>

          </div>

          {/* ── Trust strip — honest descriptors, not fake stats ── */}
          <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            {[
              { label: t("جلسات فردية ١:١", "1-on-1 live sessions"), icon: Users },
              { label: t("معلمون حاصلون على الإجازة", "Ijazah-certified teachers"), icon: GraduationCap },
              { label: t("جدول يناسبك · ٧ أيام", "Flexible schedule · 7 days"), icon: Star },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-center gap-3 rounded-xl border border-surface-border/60 bg-surface/40 px-5 py-4 text-sm">
                <s.icon size={18} className="text-gold shrink-0" />
                <span className="text-foreground">{s.label}</span>
              </div>
            ))}
          </div>

          {/* ── Hero-level social proof — one strong testimonial ── */}
          <figure className="mx-auto mt-10 max-w-2xl rounded-2xl border border-surface-border/60 bg-surface/40 px-6 py-5">
            <blockquote className="text-base leading-relaxed text-foreground">
              {t(
                "«أتممتُ حفظ جزء عمّ في ثلاثة أشهر فقط بفضل الله ثم بفضل معلمتي الرائعة.»",
                "“I completed memorizing Juz Amma in just three months, by the grace of Allah and my wonderful teacher.”",
              )}
            </blockquote>
            <figcaption className="mt-3 flex items-center gap-2 text-xs text-muted">
              <span className="font-medium text-foreground">{t("فاطمة السيد", "Fatima Al-Sayed")}</span>
              <span className="text-muted">·</span>
              <span>{t("الكويت 🇰🇼", "Kuwait 🇰🇼")}</span>
            </figcaption>
          </figure>
        </div>

        {/* Bottom fade into next section */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* ══════════════════════════════════════════
          HOW IT WORKS — alternating bg
          ══════════════════════════════════════════ */}
      <RevealSection className="section-light py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted">{t("كيف يعمل", "How it works")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold leading-tight">{t("ابدأ في ٣ خطوات بسيطة", "Start in 3 Simple Steps")}</h2>
          </div>

          {/* Horizontal journey flow — dashed connector between large numbered steps.
              On mobile collapses to a stacked vertical path with a left-side rail. */}
          <div className="mt-16">
            <ol className="relative mx-auto grid max-w-4xl gap-10 md:grid-cols-3 md:gap-6">
              {/* Desktop connector rail — sits behind the number medallions */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-8 hidden h-px border-t border-dashed border-gold/25 md:block"
              />
              {howItWorks.map((step, i) => {
                const Icon = resolveIcon(step.icon_name);
                const arNums = ["١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
                return (
                  <li key={step.id} className="relative flex flex-col items-center text-center">
                    {/* Number medallion — solid gold, sits on the rail */}
                    <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-gold font-display text-2xl font-bold text-background shadow-md">
                      {t(arNums[i] ?? String(i + 1), String(i + 1))}
                    </div>
                    <Icon size={22} className="mt-5 text-gold/70" aria-hidden="true" />
                    <h3 className="mt-3 text-lg font-bold">{t(step.title_ar, step.title_en)}</h3>
                    <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{t(step.description_ar ?? "", step.description_en ?? "")}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </RevealSection>

      {/* ══════════════════════════════════════════
          WHY FURQAN — editorial spotlight
          Asymmetric two-up: a large quietly-emphatic
          principle on the start side, the remaining
          differentiators stacked as compact rows. Breaks
          the 4-card grid monotony of the rest of the page.
          ══════════════════════════════════════════ */}
      <RevealSection className="section-accent islamic-pattern relative py-24">
        <div className="pointer-events-none absolute inset-0 bg-background/40" />
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted">{t("لماذا فرقان", "Why Furqan")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold leading-tight">{t("لماذا تختار فرقان؟", "Why Choose FURQAN?")}</h2>
          </div>

          {whyUs.length > 0 && (() => {
            const [hero, ...rest] = whyUs;
            const HeroIcon = resolveIcon(hero.icon_name);
            return (
              <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-5">
                <article className="lg:col-span-3 relative overflow-hidden rounded-3xl border border-gold/20 bg-surface/40 p-8 sm:p-10">
                  <div className="pointer-events-none absolute -end-12 -top-12 h-44 w-44 rounded-full bg-gold/10 blur-2xl" aria-hidden="true" />
                  <div className="relative">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/10">
                      <HeroIcon size={22} className="text-gold" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <h3 className="font-display mt-6 text-2xl font-bold leading-snug sm:text-3xl">
                      {t(hero.title_ar, hero.title_en)}
                    </h3>
                    <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
                      {t(hero.description_ar ?? "", hero.description_en ?? "")}
                    </p>
                  </div>
                </article>
                <ul className="lg:col-span-2 grid gap-3">
                  {rest.map((f) => {
                    const Icon = resolveIcon(f.icon_name);
                    return (
                      <li
                        key={f.id}
                        className="flex items-start gap-4 rounded-2xl border border-surface-border/60 bg-surface/40 p-5 transition-colors duration-200 hover:border-gold/30"
                      >
                        <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold/10">
                          <Icon size={18} className="text-gold" strokeWidth={1.75} aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold leading-snug">{t(f.title_ar, f.title_en)}</h3>
                          <p className="mt-1 text-xs leading-relaxed text-muted">{t(f.description_ar ?? "", f.description_en ?? "")}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}
        </div>
      </RevealSection>

      {/* ══════════════════════════════════════════
          COURSES — clean section
          ══════════════════════════════════════════ */}
      <RevealSection className="py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted">{t("التخصصات", "Courses")}</p>
            <h2 className="font-display mt-3 text-4xl font-bold leading-tight">{t("ما نُعلّمه في فرقان", "What We Teach at FURQAN")}</h2>
          </div>

          {/* Asymmetric grid: 1st card spans 2 cols on desktop to break the
              uniform card-of-cards rhythm. The eye lands on the lead subject
              first, then scans the supporting tracks. */}
          <div className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3 md:auto-rows-fr">
            {subjects.map((c, idx) => {
              const Icon = resolveIcon(c.icon_name);
              const meta = c.meta as SubjectMeta;
              const isLead = idx === 0;
              return (
                <Link
                  key={c.id}
                  href="/services"
                  className={[
                    "group relative overflow-hidden rounded-2xl border border-surface-border/60 bg-surface/40 p-5 transition-colors duration-200 hover:border-gold/40",
                    isLead ? "col-span-2 md:row-span-1 md:p-7" : "",
                  ].join(" ")}
                >
                  <div className={[
                    "inline-flex items-center justify-center rounded-xl bg-gold/10",
                    isLead ? "h-12 w-12" : "h-10 w-10",
                  ].join(" ")}>
                    <Icon size={isLead ? 22 : 18} className="text-gold" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  {meta.level_ar && meta.level_en && (
                    <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.15em] text-gold/70">
                      {t(meta.level_ar, meta.level_en)}
                    </p>
                  )}
                  <h3 className={["mt-1 font-bold", isLead ? "text-base sm:text-lg" : "text-sm"].join(" ")}>
                    {t(c.title_ar, c.title_en)}
                  </h3>
                  <p className={["mt-1 leading-relaxed text-muted", isLead ? "text-sm max-w-md" : "text-xs"].join(" ")}>
                    {t(c.description_ar ?? "", c.description_en ?? "")}
                  </p>
                </Link>
              );
            })}
          </div>

          <div className="mt-8 text-center">
            <Link href="/services" className="text-sm font-medium text-gold transition-colors hover:text-gold-light">
              {t("عرض جميع الخدمات ←", "View All Services →")}
            </Link>
          </div>
        </div>
      </RevealSection>

      {/* ══════════════════════════════════════════
          CREDENTIALS — scholar certification bar
          (distinct from hero trust strip — this is
          about institutional authority, not product)
          ══════════════════════════════════════════ */}
      <RevealSection className="border-y border-surface-border/60 bg-surface/30 py-10">
        <div className="mx-auto max-w-5xl px-6">
          <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-muted">
            {t("الاعتمادات العلمية", "Scholarly credentials")}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {trustStrip.map((b) => {
              const Icon = resolveIcon(b.icon_name);
              return (
                <div key={b.id} className="flex items-center gap-2 text-sm">
                  <Icon size={18} className="text-foreground/70" strokeWidth={1.75} aria-hidden="true" />
                  <span className="text-foreground">{t(b.title_ar, b.title_en)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </RevealSection>

      {/* ══════════════════════════════════════════
          TESTIMONIALS — with pattern bg
          ══════════════════════════════════════════ */}
      <div className="section-light">
        <Testimonials />
      </div>

      {/* ── FINAL CTA ── */}
      <RegisterBanner />
    </div>
  );
}
