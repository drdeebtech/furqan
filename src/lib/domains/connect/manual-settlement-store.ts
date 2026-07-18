import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import type {
  ManualSettlementOutcome,
  ManualSettlementStore,
  ManualSettlementValues,
} from "./manual-settlement";

type AdminClient = ReturnType<typeof createAdminClient>;

// The RPC's jsonb outcome, validated at the boundary — an unexpected shape is a
// thrown error (fail closed), never a guessed outcome on a money path.
const settleOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("settled"),
    net_paid_cents: z.number().int().min(0),
    recovered_cents: z.number().int().min(0),
  }),
  z.object({
    outcome: z.literal("closed_debt_recovered"),
    recovered_cents: z.number().int().min(0),
  }),
  z.object({ outcome: z.literal("stale_net"), net_due_cents: z.number().int().min(0) }),
  z.object({ outcome: z.literal("teacher_on_hold") }),
  z.object({ outcome: z.literal("not_found") }),
]);

/**
 * Spec 040 Phase 1 (item 5) + FR-027a — the production `ManualSettlementStore`,
 * backing settleManualPayout with real Postgres via the SECURITY DEFINER
 * connect_settle_manual_due (4-arg, migration 20260811), called through the
 * typed `callRpc` seam (mirrors ConnectSweepStore).
 *
 * One atomic conditional RPC returning a typed outcome. A transport/DB error or
 * an unrecognized payload is thrown, never coerced to a refusal — the caller
 * must fail closed, not silently drop a settlement.
 */
export class ConnectManualSettlementStore implements ManualSettlementStore {
  constructor(private readonly admin: AdminClient) {}

  async settleManualDue(input: ManualSettlementValues): Promise<ManualSettlementOutcome> {
    const { data, error } = await callRpc(this.admin, "connect_settle_manual_due", {
      p_entry_id: input.entryId,
      p_reference_id: input.referenceId ?? null,
      p_settling_admin: input.settlingAdmin,
      p_expected_net_cents: input.expectedNetCents,
    });
    if (error) {
      throw new Error(
        `ConnectManualSettlementStore.settleManualDue: rpc failed (${error.code ?? "?"}): ${error.message}`,
      );
    }
    const parsed = settleOutcomeSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(
        `ConnectManualSettlementStore.settleManualDue: unrecognized rpc outcome: ${JSON.stringify(data)}`,
      );
    }
    const o = parsed.data;
    switch (o.outcome) {
      case "settled":
        return { outcome: "settled", netPaidCents: o.net_paid_cents, recoveredCents: o.recovered_cents };
      case "closed_debt_recovered":
        return { outcome: "closed_debt_recovered", recoveredCents: o.recovered_cents };
      case "stale_net":
        return { outcome: "stale_net", netDueCents: o.net_due_cents };
      default:
        return { outcome: o.outcome };
    }
  }
}

/** Convenience factory: a store bound to a fresh service-role admin client. */
export function createConnectManualSettlementStore(): ConnectManualSettlementStore {
  return new ConnectManualSettlementStore(createAdminClient());
}
