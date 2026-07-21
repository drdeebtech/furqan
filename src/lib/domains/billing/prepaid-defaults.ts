/**
 * Fallback values for the prepaid-hours wallet, used when `platform_settings`
 * cannot be read or holds an invalid value.
 *
 * WHY THIS MODULE EXISTS
 * These numbers were previously hardcoded THREE times — the public pricing page
 * and both checkout routes (Stripe and PayPal) each kept their own copy. Every
 * copy said 10, which was harmless only because the seeded rate was also 10.
 * When migration 20260817000000 raised the seeded rate to $14, the duplicates
 * silently became wrong, and two of them are on the CHARGE path
 * (`amountCents = hours × rateUsd × 100`) — a settings-read failure would have
 * billed a student $10/hr for a $14/hr product.
 *
 * The canonical rate lives in `platform_settings.prepaid_hours_rate_usd`. These
 * are only the last resort when that read fails. Keep them in step with the
 * seed: if you change the setting's default in a migration, change it here in
 * the same PR.
 *
 * FOLLOW-UP (not done here): on the charge path, failing closed — refusing the
 * purchase when the canonical rate is unreadable — is safer than billing any
 * fallback at all. That is a behaviour change with UX impact and belongs in its
 * own PR.
 */

/** Seeded by 20260817000000_hifz_price_ladder.sql. */
export const PREPAID_DEFAULT_RATE_USD = 14;

/** Seeded by 20260715000050_prepaid_hour_wallet_schema.sql. */
export const PREPAID_DEFAULT_CUSTOM_MIN = 1;

/** Seeded by 20260715000050_prepaid_hour_wallet_schema.sql. */
export const PREPAID_DEFAULT_CUSTOM_MAX = 100;
