import "server-only";
import Stripe from "stripe";

/**
 * Server-only Stripe SDK singleton (spec 018 / research R9).
 *
 * Reads `STRIPE_SECRET_KEY` from env and throws loudly at first use if it is
 * missing — a missing secret must never silently degrade into "no charges"
 * (constitution: loud failures). The key is NEVER exposed to the client:
 * `server-only` blocks any client import, and there is no `NEXT_PUBLIC_*` alias.
 *
 * API version is pinned to the SDK's latest (`2026-05-27.dahlia`) so typed
 * events match `Stripe.Event` exactly. Mode (test vs live) is purely env-driven
 * (research R10 / FR-019): swap `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
 * to go live — no code branch.
 *
 * NOTE: the webhook route constructs its own `Stripe` instance inline so that
 * signature verification can return a clean 400 on a bad/missing key instead of
 * throwing at import time. This singleton is for checkout/portal creation only.
 */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  if (!STRIPE_SECRET_KEY) {
    // Loud failure (constitution II): never fall through to an unauthenticated
    // client. Callers (checkout/portal) surface this as a 500 via logError.
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Set it in the server environment (never NEXT_PUBLIC_*).",
    );
  }
  cached = new Stripe(STRIPE_SECRET_KEY, {
    // Pin to the SDK's pinned version so Stripe.Event types are authoritative.
    apiVersion: "2026-05-27.dahlia",
    // Modest retry with idempotency keys (SDK adds them automatically) so a
    // transient blip on checkout/portal creation self-heals.
    maxNetworkRetries: 2,
    typescript: true,
  });
  return cached;
}

/**
 * Best-effort readiness probe for routes that want to return a clean 503 instead
 * of throwing mid-handler when Stripe is unconfigured (e.g. bootstrapping).
 */
export function isStripeConfigured(): boolean {
  return Boolean(STRIPE_SECRET_KEY);
}

// Re-export so callers import the type from one place (`import type { Stripe }`).
export type { Stripe };
