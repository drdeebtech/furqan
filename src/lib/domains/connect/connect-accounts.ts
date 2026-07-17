// Spec 040 (Stripe Connect payouts) — Phase 1 tail: the Connect account module.
//
// Account create-or-reuse (FR-001), Account Link minting (Phase 2's
// startConnectOnboarding calls this), the 4-state status derivation for the
// dashboard card (FR-004), and the recency-guarded status mirror the
// account.updated webhook (Phase 3) applies (FR-003).
//
// DORMANT: nothing calls this yet — the Phase 2 server action and the Phase 3
// webhook handler are the future callers. Pure DI like ./transfer-sweep: the
// Stripe surface and the DB store are injected, so unit tests run against
// in-memory fakes and the production adapter (./connect-accounts-store) wires
// the real admin client server-side.
//
// ── Idempotency argument (FR-001: "create-or-reuse", never a second account) ─
// Two racing calls for one teacher both miss the DB row and both call
// `accounts.create` — but with the SAME Stripe idempotency key
// `connect-account:{teacherId}`, so Stripe returns the SAME account to both.
// Both then link that one id; `linkAccount` is insert-or-verify (and the DB
// trigger `guard_stripe_connect_accounts_identity` makes the link one-time,
// NULL→value only), so a duplicate link of the same id is a no-op and a
// conflicting id is a loud error. Result: at most one Connect account per
// teacher, under any interleaving. (One residue: Stripe idempotency keys
// expire after ~24h — a crash between accounts.create and linkAccount retried
// later than that creates an orphan Express account at Stripe. The DB stays
// consistent; reconcile orphans by their furqan_teacher_id metadata.)
//
// ── BINDING requirements on the future callers (from pre-merge review) ──────
// Phase 2 server action:
//   * teacherId comes from auth.getUser() ONLY — never from the request body.
//   * Gate on role=teacher AND approved status, else any authenticated user
//     can mint live Stripe Express accounts (unbounded account creation).
//   * refreshUrl/returnUrl are SERVER-constructed constants — never derived
//     from user input (open redirect via the Stripe-hosted flow).
// Phase 3 account.updated handler:
//   * Stripe event.created has 1-second resolution: the <= recency guard
//     cannot order two DIFFERENT same-second events. On ties the handler must
//     accounts.retrieve the authoritative state (or dedupe by event id) —
//     never trust the event snapshot to be newest.
//   * 'unknown_account' for an account carrying furqan_teacher_id metadata
//     means the webhook beat our own linkAccount commit — re-fetch/retry
//     rather than dropping the snapshot with a 2xx.

import type { Json } from "@/types/database";

/** The 4 dashboard card states (FR-004). `manual` is decided upstream by
 *  payout_method (FR-025) — a manual-rail teacher never reaches this module. */
export type ConnectAccountStatus =
  | "none" // no account yet → "Set up payouts"
  | "onboarding_incomplete" // account exists, Express onboarding not finished
  | "pending_verification" // details submitted, Stripe still verifying
  | "payouts_enabled"; // fully enabled

export interface ConnectAccountRow {
  teacherId: string;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** Stripe requirements summary (currently_due / disabled_reason …). */
  requirements: Json | null;
  lastEventAt: Date | null;
}

export type ApplyStatusOutcome = "applied" | "stale" | "unknown_account";

/**
 * The DB seam (test seam). Production = ./connect-accounts-store (service-role
 * admin client; the `stripe_connect_accounts` RLS allows no client writes).
 */
export interface ConnectAccountsStore {
  getByTeacherId(teacherId: string): Promise<ConnectAccountRow | null>;
  /**
   * Insert-or-verify link: create the row with this account id, or verify an
   * existing row already carries EXACTLY this id (idempotent replay). A row
   * already linked to a DIFFERENT id must reject loudly (DB trigger backstops).
   */
  linkAccount(input: { teacherId: string; stripeAccountId: string }): Promise<void>;
  /**
   * Recency-guarded mirror write (FR-003): a single conditional UPDATE whose
   * WHERE carries `last_event_at IS NULL OR last_event_at <= eventAt`, so a
   * stale out-of-order event matches 0 rows and NEVER overwrites newer state.
   */
  applyAccountStatus(input: {
    stripeAccountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirements: Json | null;
    eventAt: Date;
  }): Promise<ApplyStatusOutcome>;
}

/** The only Stripe surface this module touches — structurally typed for tests. */
export interface StripeConnectApi {
  accounts: {
    create(
      params: {
        type: "express";
        metadata: Record<string, string>;
      },
      options: { idempotencyKey: string },
    ): Promise<{ id: string }>;
  };
  accountLinks: {
    create(params: {
      account: string;
      refresh_url: string;
      return_url: string;
      type: "account_onboarding";
    }): Promise<{ url: string }>;
  };
}

export interface ConnectAccountsDeps {
  store: ConnectAccountsStore;
  stripe: StripeConnectApi;
}

/**
 * FR-001: create-or-reuse the teacher's Express account. Returns the account id.
 * Never creates a second account for a teacher (see idempotency argument above).
 * A Stripe failure propagates loudly — the caller surfaces it; no row is linked.
 */
export async function ensureConnectAccount(
  deps: ConnectAccountsDeps,
  teacherId: string,
): Promise<string> {
  const existing = await deps.store.getByTeacherId(teacherId);
  if (existing?.stripeAccountId) return existing.stripeAccountId;

  const account = await deps.stripe.accounts.create(
    { type: "express", metadata: { furqan_teacher_id: teacherId } },
    { idempotencyKey: `connect-account:${teacherId}` },
  );
  await deps.store.linkAccount({ teacherId, stripeAccountId: account.id });
  return account.id;
}

/**
 * Mint a fresh hosted-onboarding Account Link for the teacher's (ensured)
 * account. Links are short-lived by design — the return/refresh routes call
 * this again for an expired link (plan Phase 2 edge case).
 */
export async function mintOnboardingLink(
  deps: ConnectAccountsDeps,
  input: { teacherId: string; refreshUrl: string; returnUrl: string },
): Promise<string> {
  const accountId = await ensureConnectAccount(deps, input.teacherId);
  const link = await deps.stripe.accountLinks.create({
    account: accountId,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: "account_onboarding",
  });
  return link.url;
}

/** Pure FR-004 card-state derivation from the mirror row. */
export function deriveAccountStatus(row: ConnectAccountRow | null): ConnectAccountStatus {
  if (!row || !row.stripeAccountId) return "none";
  if (row.payoutsEnabled) return "payouts_enabled";
  if (row.detailsSubmitted) return "pending_verification";
  return "onboarding_incomplete";
}

/**
 * FR-003: apply an account.updated snapshot to the mirror. The recency guard
 * lives in the store's conditional UPDATE; this wrapper only names the
 * outcomes so the webhook handler (Phase 3) can log stale/unknown loudly
 * without treating either as a failure (both are expected in normal operation:
 * out-of-order delivery, and events for accounts created outside this app).
 */
export async function applyAccountUpdate(
  store: ConnectAccountsStore,
  input: {
    stripeAccountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirements: Json | null;
    eventAt: Date;
  },
): Promise<ApplyStatusOutcome> {
  return store.applyAccountStatus(input);
}
