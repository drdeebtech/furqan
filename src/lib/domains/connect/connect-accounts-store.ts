import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import type { Json } from "@/types/database";
import type {
  ApplyStatusOutcome,
  ConnectAccountRow,
  ConnectAccountsStore,
} from "./connect-accounts";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Spec 040 Phase 1 tail (DB half) — the production `ConnectAccountsStore`,
 * backing the pure ./connect-accounts orchestration with real Postgres via the
 * SECURITY DEFINER functions in 20260803000000_connect_account_functions.sql,
 * through the typed `callRpc` seam (same mechanism as ./transfer-sweep-store).
 *
 * Error posture — THROW, never silent-null: a transport/DB error is logged by
 * the caller and propagates; onboarding surfaces it as a failed action, the
 * webhook handler as a retryable failure. The insert-or-verify and recency
 * guarantees live in the SQL, not here.
 *
 * DORMANT: nothing constructs this until the Phase 2 onboarding action and
 * the Phase 3 account.updated handler ship.
 */
export class PostgresConnectAccountsStore implements ConnectAccountsStore {
  constructor(private readonly admin: AdminClient) {}

  async getByTeacherId(teacherId: string): Promise<ConnectAccountRow | null> {
    const { data, error } = await callRpc(this.admin, "connect_get_account", {
      p_teacher_id: teacherId,
    });
    if (error) throw accountsRpcError("getByTeacherId", error);
    const row = (data ?? [])[0];
    if (!row) return null;
    return {
      teacherId: row.teacher_id,
      stripeAccountId: row.stripe_account_id,
      chargesEnabled: row.charges_enabled,
      payoutsEnabled: row.payouts_enabled,
      detailsSubmitted: row.details_submitted,
      requirements: row.requirements,
      lastEventAt: row.last_event_at ? new Date(row.last_event_at) : null,
    };
  }

  async linkAccount(input: { teacherId: string; stripeAccountId: string }): Promise<void> {
    const { error } = await callRpc(this.admin, "connect_link_account", {
      p_teacher_id: input.teacherId,
      p_stripe_account_id: input.stripeAccountId,
    });
    if (error) throw accountsRpcError("linkAccount", error);
  }

  async applyAccountStatus(input: {
    stripeAccountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirements: Json | null;
    eventAt: Date;
  }): Promise<ApplyStatusOutcome> {
    const { data, error } = await callRpc(this.admin, "connect_apply_account_status", {
      p_stripe_account_id: input.stripeAccountId,
      p_charges_enabled: input.chargesEnabled,
      p_payouts_enabled: input.payoutsEnabled,
      p_details_submitted: input.detailsSubmitted,
      // Coalesced to null because the JS client silently DROPS a named arg
      // whose value is undefined, which would fail the RPC with a
      // signature mismatch.
      p_requirements: input.requirements ?? null,
      p_event_at: input.eventAt.toISOString(),
    });
    if (error) throw accountsRpcError("applyAccountStatus", error);
    if (data !== "applied" && data !== "stale" && data !== "unknown_account") {
      throw new Error(`connect-accounts-store.applyAccountStatus: unexpected outcome '${data}'`);
    }
    return data;
  }
}

function accountsRpcError(method: string, error: { message: string; code?: string }): Error {
  return new Error(
    `connect-accounts-store.${method} rpc failed: ${error.message}${error.code ? ` (${error.code})` : ""}`,
  );
}

export function createConnectAccountsStore(): PostgresConnectAccountsStore {
  return new PostgresConnectAccountsStore(createAdminClient());
}
