import "server-only";
import type { Stripe } from "@/lib/stripe/client";
import { logError } from "@/lib/logger";
import { chunk } from "@/lib/promise-utils";

/**
 * Max concurrent Stripe retrieves. A student's payment list is bounded at
 * PAYMENTS_HISTORY_LIMIT (100) in `student-billing.ts`; firing all at once would risk
 * Stripe's rate limit, so we batch. 8 keeps well under the limit while
 * staying fast for the typical handful of payments.
 */
const RECEIPT_FETCH_CONCURRENCY = 8;

/** Fetch one PaymentIntent's receipt URL; never throws (best-effort → null). */
async function fetchReceiptUrl(
  stripe: Stripe,
  id: string,
): Promise<[string, string | null]> {
  try {
    const pi = await stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] });
    const charge = pi.latest_charge;
    const receiptUrl =
      charge && typeof charge !== "string" ? charge.receipt_url ?? null : null;
    return [id, receiptUrl];
  } catch (err) {
    // Non-critical: log and degrade this one row to "no receipt link".
    logError("billing: receipt url retrieve failed", err, {
      tag: "billing",
      metadata: { paymentIntent: id },
    });
    return [id, null];
  }
}

/**
 * Best-effort resolve of Stripe receipt URLs for a set of PaymentIntent ids.
 *
 * The billing page reads the authoritative payment list from our own `payments`
 * table (RLS-scoped) — the receipt link is non-critical presentation metadata we
 * fetch live from Stripe rather than mirror into our DB. Because it is
 * non-critical, one PaymentIntent's failure MUST NOT break the others or the
 * page: each retrieve is isolated and falls back to `null`.
 *
 * The Charge (which carries `receipt_url`) is not on the PaymentIntent by
 * default, so we expand `latest_charge`. A `receipt_url` covers every payment
 * type uniformly (subscription-invoice charges, single-session, prepaid), which
 * is why we key off the PI stored on every `payments` row rather than special-
 * casing subscription invoices.
 *
 * @param stripe  Injected Stripe client (test seam).
 * @param piIds   PaymentIntent ids (nulls/blanks are skipped).
 * @returns Map keyed by PaymentIntent id → `receipt_url` (or `null` when the PI
 *          has no charge yet, no receipt, or the retrieve failed).
 */
export async function resolveReceiptUrls(
  stripe: Stripe,
  piIds: readonly (string | null)[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(piIds.filter((id): id is string => Boolean(id)))];

  // Bounded concurrency: batch the retrieves so a long payment history can't
  // fire 100 concurrent Stripe calls in one render (rate-limit safety).
  const result = new Map<string, string | null>();
  for (const batch of chunk(unique, RECEIPT_FETCH_CONCURRENCY)) {
    const entries = await Promise.all(batch.map((id) => fetchReceiptUrl(stripe, id)));
    for (const [id, url] of entries) result.set(id, url);
  }

  return result;
}
