import { QURAN_QUOTES, type QuoteName } from "@/lib/quran/ayah-text";

interface AyahQuoteProps {
  /** A named quotation from the verified module (src/lib/quran/ayah-text.ts). */
  name: QuoteName;
  className?: string;
}

/**
 * Renders a verified Quran quotation wrapped in the ornamental brackets ﴿ ﴾.
 *
 * The ayah text comes ONLY from the verified module — this component is the
 * single place the ﴿ ﴾ ornament is allowed to appear, enforced by the
 * grep-guard in src/lib/quran/ayah-text.test.ts. Scripture is never hardcoded
 * inline in a page again; add a new verse to the module (verified) and reference
 * it here by name.
 *
 * `lang="ar" dir="rtl"` keeps the glyphs correct regardless of the host page's
 * direction; `aria-label` gives the citation to assistive tech.
 */
export function AyahQuote({ name, className }: AyahQuoteProps) {
  const quote = QURAN_QUOTES[name];
  return (
    <span lang="ar" dir="rtl" className={className} aria-label={quote.reference}>
      ﴿ {quote.text} ﴾
    </span>
  );
}
