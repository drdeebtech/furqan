"use client";

import { memo } from "react";
import { useLang } from "@/lib/i18n/context";
import { useFeatureFlags } from "@/lib/feature-flags-context";
import { useTestimonials } from "@/lib/testimonials-context";

const TestimonialsComponent = function Testimonials() {
  const { t } = useLang();
  const { hideReviews } = useFeatureFlags();
  const reviews = useTestimonials();

  // Admin toggle hides the section; an empty published set hides it too — never
  // advertise an empty room (and never fall back to fabricated placeholder
  // quotes). The data is admin-curated and published-only (spec 035 US3).
  if (hideReviews || reviews.length === 0) return null;

  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-gold/80">{t("آراء الطلاب", "Student reviews")}</p>
          <h2 className="font-display mt-3 text-4xl font-bold">{t("ماذا يقول طلابنا؟", "What Our Students Say")}</h2>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((r) => {
            // Show the English quote to English visitors when present; otherwise
            // fall back to the Arabic quote (every testimonial has quote_ar).
            const quote = t(r.quoteAr, r.quoteEn || r.quoteAr);
            return (
              <figure key={r.id} className="rounded-2xl border border-surface-border/60 bg-surface/40 p-6 transition-colors duration-200 hover:border-gold/30">
                <blockquote className="text-sm leading-relaxed text-foreground">
                  {quote}
                </blockquote>
                <figcaption className="mt-4 border-t border-surface-border/60 pt-3">
                  <p className="text-sm font-semibold text-foreground">{r.authorName}</p>
                  {r.authorLocation && (
                    <p className="mt-0.5 text-xs text-muted">{r.authorLocation}</p>
                  )}
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export const Testimonials = memo(TestimonialsComponent);
