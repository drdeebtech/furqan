"use server";

// Spec 040 Phase 4 — admin payout ops actions (FR-023/025/027).
//
// Every action: requireAdmin() FIRST (identity from the session, never from
// input — the acting admin id is what gets stamped into the audit trail),
// zod at the boundary, service-role writes only through this server module.
// Error surfaces are generic strings (no internals leak); details go to
// logError with route/widget tags.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin, ForbiddenError, UnauthenticatedError } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import { logError } from "@/lib/logger";
import {
  settleManualPayout,
  ManualSettlementError,
} from "@/lib/domains/connect/manual-settlement";
import { createConnectManualSettlementStore } from "@/lib/domains/connect/manual-settlement-store";

export type PayoutAdminErrorCode =
  | "unauthorized"
  | "invalid_input"
  | "not_found"
  | "unavailable"
  // FR-027a settle refusals — the UI must render these distinctly:
  | "stale_net"       // net changed since the queue rendered; note carries the fresh USD amount
  | "teacher_on_hold"; // an active payout hold binds the manual rail too

export type PayoutAdminResult =
  | { ok: true; note?: string }
  | { ok: false; error: PayoutAdminErrorCode; note?: string };

function failure(code: PayoutAdminErrorCode, note?: string): PayoutAdminResult {
  return { ok: false, error: code, ...(note !== undefined ? { note } : {}) };
}

async function adminOr(): Promise<{ id: string } | PayoutAdminResult> {
  try {
    return await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof UnauthenticatedError) {
      return failure("unauthorized");
    }
    throw e;
  }
}

const holdSchema = z.object({
  teacherId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

/** FR-023: place an admin hold — an unreleased row blocks the sweep for the teacher. */
export async function placePayoutHold(input: z.input<typeof holdSchema>): Promise<PayoutAdminResult> {
  const admin = await adminOr();
  if ("ok" in admin) return admin;
  const parsed = holdSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_input");

  try {
    const { error } = await callRpc(createAdminClient(), "connect_admin_place_hold", {
      p_teacher_id: parsed.data.teacherId,
      p_reason: parsed.data.reason,
      p_actor: admin.id,
    });
    if (error) throw error;
  } catch (e) {
    // Rejected transport AND returned PostgREST errors both normalize to the
    // generic result — a server action must never throw at the client.
    logError("admin payouts: place hold failed", e, {
      tag: "admin-payouts", route: "/admin/payouts", widget: "hold-place", userId: admin.id,
    });
    return failure("unavailable");
  }
  revalidatePath("/admin/payouts");
  return { ok: true };
}

const liftSchema = z.object({ holdId: z.uuid() });

/**
 * FR-023: lift a hold (admin OR a stale `dispute:*` hold whose
 * charge.dispute.closed never arrived — this is the designed recovery path,
 * Phase 3b security review). Attribution is stamped from the session.
 */
export async function liftPayoutHold(input: z.input<typeof liftSchema>): Promise<PayoutAdminResult> {
  const admin = await adminOr();
  if ("ok" in admin) return admin;
  const parsed = liftSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_input");

  let lifted: unknown;
  try {
    const { data, error } = await callRpc(createAdminClient(), "connect_admin_lift_hold", {
      p_hold_id: parsed.data.holdId,
      p_actor: admin.id,
    });
    if (error) throw error;
    lifted = data;
  } catch (e) {
    logError("admin payouts: lift hold failed", e, {
      tag: "admin-payouts", route: "/admin/payouts", widget: "hold-lift", userId: admin.id,
    });
    return failure("unavailable");
  }
  if (lifted !== "lifted") return failure("not_found"); // already released / unknown id
  revalidatePath("/admin/payouts");
  return { ok: true };
}

const methodSchema = z.object({
  teacherId: z.uuid(),
  method: z.enum(["stripe_connect", "manual"]),
});

/** FR-025: audited rail switch (atomic update + audit row + stuck-manual_due re-route). */
export async function setPayoutMethod(input: z.input<typeof methodSchema>): Promise<PayoutAdminResult> {
  const admin = await adminOr();
  if ("ok" in admin) return admin;
  const parsed = methodSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_input");

  let result: unknown;
  try {
    const { data, error } = await callRpc(createAdminClient(), "connect_admin_set_payout_method", {
      p_teacher_id: parsed.data.teacherId,
      p_method: parsed.data.method,
      p_actor: admin.id,
    });
    if (error) throw error;
    result = data;
  } catch (e) {
    logError("admin payouts: set payout method failed", e, {
      tag: "admin-payouts", route: "/admin/payouts", widget: "method-switch", userId: admin.id,
    });
    return failure("unavailable");
  }
  const outcome = (Array.isArray(result) ? result[0] : null) as
    | { outcome: string; rerouted_entries: number }
    | null;
  revalidatePath("/admin/payouts");
  return {
    ok: true,
    note:
      outcome?.outcome === "changed" && outcome.rerouted_entries > 0
        ? `rerouted ${outcome.rerouted_entries} stuck manual entries to the Stripe rail`
        : outcome?.outcome,
  };
}

const settleSchema = z.object({
  entryId: z.uuid(),
  // Optional: the zero-net close pays nothing, so no reference exists. The
  // domain schema still enforces reference-required whenever net > 0.
  referenceId: z.string().trim().max(255).optional(),
  // FR-027a optimistic fence: the net the queue displayed to the admin. The
  // RPC re-derives the true net at its serialization point and refuses on drift.
  expectedNetCents: z.number().int().min(0),
});

/**
 * FR-027/FR-027a: settle one manual_due entry off-Stripe at its NET value.
 * The RPC's locked conditional update is the serialization point (replay-safe;
 * refuses stripe_connect entries; nets settle-time debt; honors holds); the
 * settling admin comes from the session, never from input.
 */
export async function settleManualDueEntry(input: z.input<typeof settleSchema>): Promise<PayoutAdminResult> {
  const admin = await adminOr();
  if ("ok" in admin) return admin;
  const parsed = settleSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_input");

  try {
    const outcome = await settleManualPayout(createConnectManualSettlementStore(), {
      entryId: parsed.data.entryId,
      referenceId: parsed.data.referenceId || null,
      settlingAdmin: admin.id,
      expectedNetCents: parsed.data.expectedNetCents,
    });
    switch (outcome.outcome) {
      case "settled":
        revalidatePath("/admin/payouts");
        return {
          ok: true,
          note:
            outcome.recoveredCents > 0
              ? `paid $${(outcome.netPaidCents / 100).toFixed(2)} net of $${(outcome.recoveredCents / 100).toFixed(2)} debt`
              : undefined,
        };
      case "closed_debt_recovered":
        revalidatePath("/admin/payouts");
        return { ok: true, note: "closed — fully consumed by outstanding debt, nothing to pay" };
      case "stale_net":
        // Refresh so the queue re-renders with the fresh number.
        revalidatePath("/admin/payouts");
        return failure("stale_net", `net is now $${(outcome.netDueCents / 100).toFixed(2)} — re-check and retry`);
      case "teacher_on_hold":
        return failure("teacher_on_hold");
      case "not_found":
        return failure("not_found"); // replay / wrong status / wrong rail — legit no-op
    }
  } catch (e) {
    if (e instanceof ManualSettlementError) return failure("invalid_input");
    logError("admin payouts: manual settle failed", e, {
      tag: "admin-payouts", route: "/admin/payouts", widget: "manual-settle", userId: admin.id,
    });
    return failure("unavailable");
  }
}

interface ManualDueCsvRow {
  entry_id: string;
  teacher_id: string;
  full_name: string;
  amount_cents: number;
  /** FR-027a: what the admin actually pays (remaining minus FIFO debt share). */
  net_due_cents: number;
  recovered_cents: number;
  session_delivery_id: string | null;
  delivered_at: string | null;
  created_at: string;
}

/**
 * FR-027: export the manual_due queue as CSV (teacher, amount, session ref,
 * period). No secrets in the payload; the export itself is audit-logged
 * (connect_payout_audit event `manual_due_export`).
 */
export async function exportManualDueCsv(): Promise<
  { ok: true; csv: string; rows: number } | Extract<PayoutAdminResult, { ok: false }>
> {
  const admin = await adminOr();
  if ("ok" in admin && admin.ok === false) return admin;
  const adminUser = admin as { id: string };

  const client = createAdminClient();
  let snapshot: unknown;
  try {
    const { data, error } = await callRpc(client, "connect_admin_payouts_overview", {});
    if (error) throw error;
    snapshot = data;
  } catch (e) {
    logError("admin payouts: export overview failed", e, {
      tag: "admin-payouts", route: "/admin/payouts", widget: "manual-export", userId: adminUser.id,
    });
    return failure("unavailable") as Extract<PayoutAdminResult, { ok: false }>;
  }
  const manualDue =
    ((snapshot as { manual_due?: ManualDueCsvRow[] } | null)?.manual_due ?? []) as ManualDueCsvRow[];

  // Quote-double for CSV, and neutralize spreadsheet formula injection
  // (security review P2): a teacher-controlled full_name starting with
  // = + - @ tab or CR would otherwise execute as a formula when the admin
  // opens the export in Excel/Sheets.
  const esc = (v: string | number | null) => {
    const raw = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  // net_due_usd is THE payable column (FR-027a) — amount_usd stays as the gross
  // for reconciliation; already_recovered_usd explains any difference.
  const csv = [
    "entry_id,teacher_id,teacher_name,amount_usd,net_due_usd,already_recovered_usd,session_delivery_id,delivered_at,entry_created_at",
    ...manualDue.map((r) =>
      [
        esc(r.entry_id), esc(r.teacher_id), esc(r.full_name),
        esc((r.amount_cents / 100).toFixed(2)),
        esc((r.net_due_cents / 100).toFixed(2)),
        esc((r.recovered_cents / 100).toFixed(2)),
        esc(r.session_delivery_id), esc(r.delivered_at), esc(r.created_at),
      ].join(","),
    ),
  ].join("\n");

  // The export is REFUSED if it cannot be audited (fail-closed: an unlogged
  // export of payable amounts is what the audit exists to prevent).
  try {
    const { error: auditErr } = await callRpc(client, "connect_admin_log_export", {
      p_actor: adminUser.id,
      p_rows: manualDue.length,
    });
    if (auditErr) throw auditErr;
  } catch (e) {
    logError("admin payouts: export audit write failed", e, {
      tag: "admin-payouts", route: "/admin/payouts", widget: "manual-export", userId: adminUser.id,
    });
    return failure("unavailable") as Extract<PayoutAdminResult, { ok: false }>;
  }

  return { ok: true, csv, rows: manualDue.length };
}
