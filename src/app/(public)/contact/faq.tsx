import { ChevronDown } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { getActiveFaqs } from "@/lib/site-content/queries";
import { safeJsonLd } from "@/components/seo/structured-data";

export async function FAQ() {
  const { t } = await getT();
  const faqs = await getActiveFaqs();

  if (faqs.length === 0) return null;

  // FAQPage JSON-LD built from the SAME rows + language resolution rendered below,
  // so the structured data always matches the visible DOM (Google FAQ-policy safe).
  // Replaces the old static site-wide FAQSchema that violated that policy.
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: t(faq.question_ar, faq.question_en),
      acceptedAnswer: { "@type": "Answer", text: t(faq.answer_ar, faq.answer_en) },
    })),
  };

  return (
    <section className="py-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
      />
      <div className="mx-auto max-w-3xl px-6">
        <p className="text-sm font-medium tracking-widest text-muted">❖ {t("أسئلة شائعة", "FAQ")}</p>
        <h2 className="font-display mt-3 text-3xl font-bold leading-tight">{t("الأسئلة الشائعة", "Frequently Asked Questions")}</h2>

        <div className="mt-12 space-y-2">
          {faqs.map((faq) => (
            <details key={faq.id} className="glass-card group">
              <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-right text-sm font-medium transition-colors hover:text-gold focus-ring">
                {t(faq.question_ar, faq.question_en)}
                <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-[var(--surface-border)] px-6 py-4">
                <p className="text-sm leading-relaxed text-muted">{t(faq.answer_ar, faq.answer_en)}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
