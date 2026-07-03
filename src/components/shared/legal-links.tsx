import Link from "next/link";
import { cn } from "@/lib/cn";

type LegalLinksProps = {
  className?: string;
};

// All four links are equally interactive and point to the same two routes, so
// they share one style — gold applied consistently across both language pairs
// (the earlier Arabic-only gold was arbitrary). One const keeps them from drifting.
const legalLinkClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded px-1 text-gold hover:text-gold-hover underline focus-ring";

/** Bilingual terms + privacy links shared by auth consent surfaces. */
export function LegalLinks({ className }: LegalLinksProps) {
  return (
    <p
      data-testid="legal-links"
      className={cn("flex flex-wrap items-center gap-x-1 text-[11px]", className)}
    >
      <Link href="/terms" className={legalLinkClass}>
        الشروط والأحكام
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/privacy" className={legalLinkClass}>
        سياسة الخصوصية
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/terms" className={legalLinkClass}>
        Terms
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/privacy" className={legalLinkClass}>
        Privacy Policy
      </Link>
    </p>
  );
}
