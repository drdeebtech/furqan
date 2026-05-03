import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { logError } from "@/lib/logger";
import { withCronMonitor } from "@/lib/sentry/cron";

export const dynamic = "force-dynamic";

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Daily Resend API key health check.
 *
 * Why this exists: the same RESEND_API_KEY is used in two places —
 * Vercel env (for our direct app emails) and Supabase Auth's custom
 * SMTP config (for password-reset / verification emails). When the
 * key is rotated in Resend's dashboard but not updated in both
 * consumer locations, every transactional email silently fails.
 *
 * This cron pings Resend's cheapest authenticated endpoint
 * (`GET /domains`) once a day. If the key is invalid (401/403) or
 * Resend is unreachable, it logs a critical error → Telegram fires →
 * we know to rotate before the next user hits the broken pipeline.
 *
 * Trigger: n8n (Mac mini) — schedule a workflow that GETs this endpoint
 * with the `X-N8N-Secret` header. Cadence: daily at 06:00 UTC. The
 * schedule string passed to withCronMonitor is informational only.
 *
 * Previously fired by vercel.json crons; moved 2026-05-03 (see
 * audit-cleanup/route.ts for the full migration rationale). Still
 * accepts CRON_SECRET for operator-driven invocation.
 */
export const GET = withCronMonitor("cron-email-health", "0 6 * * *", async (request: Request) => {
  const cronAuth = request.headers.get("authorization");
  const expectedCron = `Bearer ${process.env.CRON_SECRET}`;
  const cronOk = !!process.env.CRON_SECRET && cronAuth === expectedCron;

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const n8nOk = safeCompare(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  if (!cronOk && !n8nOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logError("Resend health check: RESEND_API_KEY not set", new Error("missing-key"), {
      component: "cron.email-health",
      tag: "email-health",
      severity: "critical",
    });
    return NextResponse.json({ ok: false, reason: "missing-key" }, { status: 500 });
  }

  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${key}` },
      // 10s timeout — Resend should respond instantly; if it doesn't,
      // we want to know.
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      logError(
        "Resend API key rejected — emails are silently failing",
        new Error(`resend-key-invalid: ${res.status}`),
        {
          component: "cron.email-health",
          tag: "email-health",
          severity: "critical",
          metadata: { status: res.status, body: body.slice(0, 300) },
        },
      );
      return NextResponse.json({ ok: false, reason: "key-invalid", status: res.status }, { status: 200 });
    }

    if (!res.ok) {
      logError(
        "Resend API health check returned non-2xx",
        new Error(`resend-non-2xx: ${res.status}`),
        {
          component: "cron.email-health",
          tag: "email-health",
          severity: "warning",
          metadata: { status: res.status },
        },
      );
      return NextResponse.json({ ok: false, reason: "non-2xx", status: res.status }, { status: 200 });
    }

    return NextResponse.json({
      ok: true,
      provider: "resend",
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    logError("Resend health check threw", err, {
      component: "cron.email-health",
      tag: "email-health",
      severity: "critical",
    });
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ ok: false, reason: "fetch-threw", message: msg }, { status: 200 });
  }
});
