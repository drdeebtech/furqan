/**
 * Shared recitation-standard labels (qira'at).
 *
 * Extracted from `src/app/teacher/students/[studentId]/page.tsx` so the
 * recitation roster (and any future surface) can render the same labels
 * without duplicating the string table.
 *
 * Add a new entry here whenever the underlying enum/CHECK constraint on
 * `profiles.recitation_standard` (or wherever the current source of
 * truth lives) gains a value.
 */
export const RECITATION_STANDARD_LABEL: Record<
  string,
  { ar: string; en: string }
> = {
  hafs: { ar: "حفص عن عاصم", en: "Hafs an Asim" },
  warsh: { ar: "ورش عن نافع", en: "Warsh an Nafi" },
  qalon: { ar: "قالون عن نافع", en: "Qalun an Nafi" },
  al_duri: { ar: "الدوري عن أبي عمرو", en: "Al-Duri an Abu Amr" },
  shu_ba: { ar: "شعبة عن عاصم", en: "Shu'ba an Asim" },
};
