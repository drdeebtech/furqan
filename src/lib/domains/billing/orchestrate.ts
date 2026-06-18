import "server-only";

/**
 * Grant choreography (spec 018 / Principle III).
 *
 * The atomic payment+grant+cycle-mark is a single Postgres SECURITY DEFINER
 * function (`grant_subscription_cycle`) — the route never writes
 * `student_packages` directly. This orchestrator is a thin, testable adapter
 * that:
 *   1. builds the cycle key (additive idempotency, R3) — pure;
 *   2. calls the SECDEF fn via the service-role client (RPC);
 *   3. reports whether a NEW grant was created (vs a no-op replay).
 *
 * `emitEvent` is invoked by the route POST-commit, non-blocking (Principle III).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase.generated";
import type { GrantCycleInput, GrantCycleResult, GrantCycleFailure } from "./types";
import { logError } from "@/lib/logger";

/**
 * Build the per-cycle idempotency key (R3). Pure — no I/O.
 *
 * One grant per (invoice × subscription × period_start): a replay of the same
 * invoice yields the same key → idempotent; a renewal (new invoice / new
 * period) yields a distinct key → additive. Components are joined with `:` and
 * any `:` inside the ids is replaced to keep the key reversible/unambiguous.
 */
export function buildCycleKey(parts: {
  invoiceId: string;
  subscriptionId: string;
  periodStartIso: string;
}): string {
  const norm = (s: string) => s.replaceAll(":", "_");
  return [norm(parts.invoiceId), norm(parts.subscriptionId), norm(parts.periodStartIso)].join(":");
}

/**
 * Invoke `grant_subscription_cycle(...)` via RPC. Service-role client only.
 *
 * Returns `{ grantId, created }`. `created` is determined by checking whether
 * a student_packages row with this cycle_key already existed BEFORE the call —
 * the function itself is idempotent, so this is informational (for emit: first
 * activation vs renewal). On any failure returns `{ ok: false }` loudly.
 */
export async function grantCycle(
  admin: SupabaseClient<Database>,
  input: GrantCycleInput,
): Promise<GrantCycleResult | GrantCycleFailure> {
  try {
    // Did a grant for this cycle already exist? (idempotent replay detection)
    const { data: prior } = await admin
      .from("student_packages")
      .select("id")
      .eq("billing_cycle_key", input.cycleKey)
      .maybeSingle();
    const existedBefore = Boolean(prior);

    const { data, error } = await admin.rpc("grant_subscription_cycle", {
      p_subscription_id: input.subscriptionId,
      p_student_id: input.studentId,
      p_plan_id: input.planId,
      p_cycle_key: input.cycleKey,
      p_stripe_payment_intent: input.stripePaymentIntent,
      p_amount_cents: input.amountCents,
      p_credit_count: input.creditCount,
      p_expires_at: input.expiresAt,
      p_session_metadata: input.sessionMetadata as unknown as Json,
    });

    if (error) {
      logError("billing.grantCycle RPC failed", error, {
        tag: "billing", cycle_key: input.cycleKey, subscription_id: input.subscriptionId,
      });
      return { ok: false, error: error.message };
    }
    if (!data) {
      return { ok: false, error: "grant_subscription_cycle returned no id" };
    }

    return {
      ok: true,
      grantId: data as string,
      created: !existedBefore,
    };
  } catch (err) {
    logError("billing.grantCycle crashed", err, {
      tag: "billing", cycle_key: input.cycleKey,
    });
    return { ok: false, error: err instanceof Error ? err.message : "grant crashed" };
  }
}
