import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import type { ManualSettlementStore, ManualSettlementValues } from "./manual-settlement";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Spec 040 Phase 1 (item 5) — the production `ManualSettlementStore`, backing
 * settleManualPayout with real Postgres via the SECURITY DEFINER
 * connect_settle_manual_due in 20260802000000_connect_manual_settlement.sql,
 * called through the typed `callRpc` seam (mirrors ConnectSweepStore).
 *
 * One atomic conditional RPC. `false` = the fenced UPDATE hit zero rows (replay /
 * wrong status / stripe_connect refusal), a legitimate no-op. A transport/DB
 * error is thrown, never coerced to false — the caller must fail closed, not
 * silently drop a settlement.
 */
export class ConnectManualSettlementStore implements ManualSettlementStore {
  constructor(private readonly admin: AdminClient) {}

  async settleManualDue(input: ManualSettlementValues): Promise<boolean> {
    const { data, error } = await callRpc(this.admin, "connect_settle_manual_due", {
      p_entry_id: input.entryId,
      p_reference_id: input.referenceId,
      p_settling_admin: input.settlingAdmin,
    });
    if (error) {
      throw new Error(
        `ConnectManualSettlementStore.settleManualDue: rpc failed (${error.code ?? "?"}): ${error.message}`,
      );
    }
    return data === true;
  }
}

/** Convenience factory: a store bound to a fresh service-role admin client. */
export function createConnectManualSettlementStore(): ConnectManualSettlementStore {
  return new ConnectManualSettlementStore(createAdminClient());
}
