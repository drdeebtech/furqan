import { NextResponse } from "next/server";
import { sendWhatsAppNotification } from "@/lib/whatsapp";
import { logError } from "@/lib/logger";
import { safeCompareSecret } from "@/lib/security/secrets";

/**
 * Sentry watcher → WhatsApp bridge.
 *
 * The hourly Claude Code cron agent (a remote routine) reads unresolved
 * Sentry issues, drafts a triage line + proposed fix, and POSTs here.
 * This endpoint validates the shared bearer token, then dispatches a
 * formatted WhatsApp message to the admin via CallMeBot (existing helper).
 *
 * Why an endpoint rather than the cron sending WhatsApp directly:
 * the cron runs in Anthropic's cloud and cannot reach the user's local
 * CALLMEBOT_* env vars. Keeping the secret + dispatch logic in Vercel
 * means the cron only needs SENTRY_WATCH_SECRET (a single shared token).
 *
 * Request body shape:
 *   {
 *     issueId: string;        // e.g. "JAVASCRIPT-NEXTJS-E4-12"
 *     title: string;          // short error title from Sentry
 *     summary: string;        // 2-3 line triage from the cron
 *     proposedFix?: string;   // optional: cron's suggested approach
 *     issueUrl?: string;      // optional: clickable Sentry link
 *   }
 *
 * Response: { ok: true } on dispatch, { ok: false, error } on auth fail.
 */
export async function POST(req: Request) {
  const expected = process.env.SENTRY_WATCH_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "endpoint not configured" },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeCompareSecret(presented, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: {
    issueId?: string;
    title?: string;
    summary?: string;
    proposedFix?: string;
    issueUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const { issueId, title, summary, proposedFix, issueUrl } = body;
  if (!issueId || !title || !summary) {
    return NextResponse.json(
      { ok: false, error: "issueId, title, summary required" },
      { status: 400 },
    );
  }

  // Compose a single WhatsApp message. CallMeBot's free tier doesn't
  // support markdown — keep it plain. Length-cap each field defensively.
  const cap = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");
  const lines = [
    `🔔 Sentry: ${cap(issueId, 40)}`,
    cap(title, 200),
    "",
    cap(summary, 400),
  ];
  if (proposedFix) {
    lines.push("", `🛠 Suggested: ${cap(proposedFix, 300)}`);
  }
  if (issueUrl) {
    lines.push("", issueUrl);
  }
  lines.push("", "Reply OK to approve fix.");

  const message = lines.join("\n");

  try {
    await sendWhatsAppNotification(message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError("sentry-watch notify dispatch failed", err, {
      tag: "sentry-watch",
      severity: "warning",
      issueId,
    });
    return NextResponse.json({ ok: false, error: "dispatch failed" }, { status: 500 });
  }
}
