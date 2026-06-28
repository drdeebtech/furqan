/**
 * The three honest recall qualities offered for a due murajaah item, mapped to
 * the SM-2 quality scale (0–5).
 *
 * Lives in a pure, side-effect-free module (next to sm2.ts) so the q→quality
 * mapping is unit-testable on its own — importing it does NOT pull in the
 * client MurajaahCard (and its server-action / i18n / ActionFeedback graph).
 * The card imports this and renders one button per option; the resulting
 * quality flows to complete_review via markReviewComplete.
 *
 * q ≥ 3 counts as a pass (interval grows); q < 3 is a lapse (interval resets to
 * 1 day) — see ./sm2.ts.
 */
export const REVIEW_QUALITY_OPTIONS = [
  { ar: "حفظت", en: "I remembered", quality: 5 },
  { ar: "بجهد", en: "With effort", quality: 3 },
  { ar: "لم أحفظ", en: "I didn't remember", quality: 1 },
] as const;
