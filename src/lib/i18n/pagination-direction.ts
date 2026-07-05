import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";

/**
 * Pagination arrows must follow reading direction, not a fixed side.
 * In Arabic (RTL) "previous" points right and "next" points left; in
 * English (LTR) it is reversed. Extracted from the marketplace so the
 * convention is unit-testable (the component renders it inline otherwise).
 */
export function paginationIcons(lang: string): {
  PrevIcon: LucideIcon;
  NextIcon: LucideIcon;
} {
  const isRtl = lang === "ar";
  return {
    PrevIcon: isRtl ? ChevronRight : ChevronLeft,
    NextIcon: isRtl ? ChevronLeft : ChevronRight,
  };
}
