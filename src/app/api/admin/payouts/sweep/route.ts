import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import { runConnectTransferSweepOnce } from "@/lib/domains/connect/sweep-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/payouts/sweep — spec 040 Phase 4: manual sweep trigger.
 *
 * Same idempotent runner as the cron route (shared wiring in sweep-runner.ts,
 * so the two triggers cannot drift); an admin pressing the button twice — or
 * racing the cron — is safe by the sweep's lease + idempotency-key design
 * (SC-003). DORMANT until `connect_cutover_date` is armed: the claim returns
 * zero rows and no Stripe call is made.
 *
 * Auth: session admin (requireAdminForApi, fail-closed). Takes no input, so
 * there is nothing to zod-validate; the body is ignored.
 */
export async function POST() {
  const gate = await requireAdminForApi();
  if (gate instanceof NextResponse) return gate;

  try {
    const result = await runConnectTransferSweepOnce();
    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err) {
    logError("admin payouts: manual sweep failed", err, {
      tag: "admin-payouts", route: "/api/admin/payouts/sweep", userId: gate.id,
    });
    return NextResponse.json({ ok: false, error: "Sweep failed" }, { status: 500 });
  }
}
