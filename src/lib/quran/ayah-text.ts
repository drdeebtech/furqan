// Verified Quran text — the SINGLE source for any ayah rendered in the app.
//
// Text is KFGQPC (King Fahd Complex) Uthmani, fetched from Quran.com's
// `text_uthmani` and cross-checked BYTE-FOR-BYTE against Tanzil (AlQuran Cloud).
// The two masters agree on the reading; they differ only notationally.
//
// RULES (CLAUDE.md §2 — highest priority):
//  - NEVER hand-type, edit, or "correct" scripture. My own memory of 15:9 was
//    wrong on a mark; only verified bytes belong here.
//  - Add an entry ONLY via the documented process: fetch KFGQPC + cross-check a
//    second verified source, write the bytes straight from source (a script,
//    never retyped), and let ayah-text.test.ts prove every displayed quote is a
//    byte-exact substring of its verified full ayah.
//  - Preserve tashkeel/tajweed/waqf marks byte-for-byte.

/** A canonical verse address, `surah:ayah`. */
export type VerseKey = `${number}:${number}`;

/** Full verified KFGQPC Uthmani āyāt, keyed by `surah:ayah`. */
export const VERIFIED_AYAT = {
  "15:9": "إِنَّا نَحْنُ نَزَّلْنَا ٱلذِّكْرَ وَإِنَّا لَهُۥ لَحَـٰفِظُونَ",
  "73:4": "أَوْ زِدْ عَلَيْهِ وَرَتِّلِ ٱلْقُرْءَانَ تَرْتِيلًا",
  "65:2": "فَإِذَا بَلَغْنَ أَجَلَهُنَّ فَأَمْسِكُوهُنَّ بِمَعْرُوفٍ أَوْ فَارِقُوهُنَّ بِمَعْرُوفٍ وَأَشْهِدُوا۟ ذَوَىْ عَدْلٍ مِّنكُمْ وَأَقِيمُوا۟ ٱلشَّهَـٰدَةَ لِلَّهِ ۚ ذَٰلِكُمْ يُوعَظُ بِهِۦ مَن كَانَ يُؤْمِنُ بِٱللَّهِ وَٱلْيَوْمِ ٱلْـَٔاخِرِ ۚ وَمَن يَتَّقِ ٱللَّهَ يَجْعَل لَّهُۥ مَخْرَجًا",
  "65:3": "وَيَرْزُقْهُ مِنْ حَيْثُ لَا يَحْتَسِبُ ۚ وَمَن يَتَوَكَّلْ عَلَى ٱللَّهِ فَهُوَ حَسْبُهُۥٓ ۚ إِنَّ ٱللَّهَ بَـٰلِغُ أَمْرِهِۦ ۚ قَدْ جَعَلَ ٱللَّهُ لِكُلِّ شَىْءٍ قَدْرًا",
} as const satisfies Record<VerseKey, string>;

export type KnownVerseKey = keyof typeof VERIFIED_AYAT;

/**
 * A named display quotation. `text` is the exact string rendered in the UI — a
 * full ayah OR a byte-exact excerpt of `VERIFIED_AYAT[verseKey]` (proven in the
 * test). `reference` is a human label for aria/citation, never shown as scripture.
 */
export interface QuranQuote {
  readonly verseKey: KnownVerseKey;
  readonly text: string;
  readonly reference: string;
}

export const QURAN_QUOTES = {
  guardianshipOfRevelation: { verseKey: "15:9", text: "إِنَّا نَحْنُ نَزَّلْنَا ٱلذِّكْرَ وَإِنَّا لَهُۥ لَحَـٰفِظُونَ", reference: "Qur'an 15:9 (al-Hijr)" },
  reciteWithMeasure: { verseKey: "73:4", text: "وَرَتِّلِ ٱلْقُرْءَانَ تَرْتِيلًا", reference: "Qur'an 73:4 (al-Muzzammil)" },
  wayOutForThePious: { verseKey: "65:2", text: "وَمَن يَتَّقِ ٱللَّهَ يَجْعَل لَّهُۥ مَخْرَجًا", reference: "Qur'an 65:2 (at-Talaq)" },
  sufficiencyInReliance: { verseKey: "65:3", text: "وَمَن يَتَوَكَّلْ عَلَى ٱللَّهِ فَهُوَ حَسْبُهُۥٓ", reference: "Qur'an 65:3 (at-Talaq)" },
} as const satisfies Record<string, QuranQuote>;

export type QuoteName = keyof typeof QURAN_QUOTES;

/** Look up a full verified ayah; throws on an unknown key (fail-closed). */
export function getVerifiedAyah(key: KnownVerseKey): string {
  const text = VERIFIED_AYAT[key];
  if (!text) throw new Error(`No verified ayah text for ${key}`);
  return text;
}
