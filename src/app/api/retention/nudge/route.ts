import { NextResponse } from "next/server";
import { safeCompareSecret } from "@/lib/security/secrets";
import { runReengagementNudge } from "@/lib/actions/retention-nudge";

export const maxDuration = 300;

/**
 * Spec 030 — Re-engagement nudge endpoint (closes #551).
 * Dual-auth: X-N8N-Secret (n8n cron) identical to /api/retention/score.
 * All logic lives in src/lib/actions/retention-nudge.ts (CI coverage includes lib/).
 */
export async function POST(request: Request) {
  const secret = request.headers.get("X-N8N-Secret");
  if (!safeCompareSecret(secret, process.env.N8N_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runReengagementNudge();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "nudge batch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
