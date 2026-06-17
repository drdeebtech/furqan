import "server-only";

import { getSetting } from "@/lib/settings";

/**
 * Spec 022 (م٥) — Single-session pricing.
 *
 * Prices are configuration data stored in `platform_settings`, NEVER
 * hardcoded constants (FR-002). An admin can change any price and the next
 * booking reflects it with zero code changes (SC-006).
 *
 * Each function reads the price fresh at call time so an admin's update via
 * the `/api/admin/single-sessions/prices` route (T021) is reflected
 * immediately. The cache layer (`getSettings` / `getSetting`) honors
 * `revalidateTag('platform-settings')` which the admin route invokes.
 */

/** The 4 specialized purposes (mirrors the `specialized_purpose` DB enum). */
export const SPECIALIZED_PURPOSES = [
  "review",
  "consolidate_surah",
  "memorize_mutoon",
  "test_juz_mutashabihat",
] as const;
export type SpecializedPurpose = (typeof SPECIALIZED_PURPOSES)[number];

/** Maps each specialized purpose → its platform_settings price key. */
const PURPOSE_TO_SETTING_KEY: Record<SpecializedPurpose, string> = {
  review: "single_session_review_price_usd",
  consolidate_surah: "single_session_consolidate_surah_price_usd",
  memorize_mutoon: "single_session_memorize_mutoon_price_usd",
  test_juz_mutashabihat: "single_session_test_juz_price_usd",
};

/**
 * Parse a stored price string ('5.00', '0', '12.5') into a number, treating
 * invalid / missing values as **0** (free-by-default). An unconfigured key
 * must never block a booking — it must default to free, the seeded value.
 *
 * Negative values are clamped to 0 (never refund-on-creation).
 */
function parsePrice(raw: string | null): number {
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Look up the one-time price (USD) for an assessment session.
 * Returns 0 when free (admin configured `single_session_assessment_price_usd = '0.00'`).
 */
export async function getAssessmentPrice(): Promise<number> {
  return parsePrice(await getSetting("single_session_assessment_price_usd"));
}

/**
 * Look up the one-time price (USD) for an instant session.
 */
export async function getInstantPrice(): Promise<number> {
  return parsePrice(await getSetting("single_session_instant_price_usd"));
}

/**
 * Look up the one-time price (USD) for a specialized session of the given
 * purpose. Throws on an unknown purpose (defense in depth — route layer
 * zod-validates the purpose before this call).
 */
export async function getSpecializedPrice(
  purpose: SpecializedPurpose,
): Promise<number> {
  const key = PURPOSE_TO_SETTING_KEY[purpose];
  if (!key) {
    throw new Error(`unknown specialized purpose: ${purpose}`);
  }
  return parsePrice(await getSetting(key));
}
