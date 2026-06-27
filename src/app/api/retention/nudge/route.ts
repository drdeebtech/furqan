import { NextResponse } from "next/server";
import { z } from "zod";
import { safeCompareSecret } from "@/lib/security/secrets";
import { runReengagementNudge } from "@/lib/actions/retention-nudge";

export const maxDuration = 300;

// Validate the auth header at the boundary (repo contract: zod-validate every
// external input). A missing/empty header fails parse → 401 before any compare.
const secretHeaderSchema = z.string().min(1);

/**
 * Spec 030 — Re-engagement nudge endpoint (closes #551).
 * Auth: X-N8N-Secret (n8n cron) identical to /api/retention/score.
 * All logic lives in src/lib/actions/retention-nudge.ts (CI coverage includes lib/).
 */
export async function POST(request: Request) {
  const parsed = secretHeaderSchema.safeParse(request.headers.get("X-N8N-Secret"));
  if (!parsed.success || !safeCompareSecret(parsed.data, process.env.N8N_WEBHOOK_SECRET)) {
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
