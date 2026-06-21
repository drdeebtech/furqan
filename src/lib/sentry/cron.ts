// Wrap a cron-route handler with `Sentry.withMonitor` so Sentry tracks each
// run as a check-in. Effects:
//   - Sentry.io → Crons tab shows each cron's last run, status, runtime.
//   - If an expected run is missed (cutoff = checkinMargin minutes late),
//     Sentry creates an issue + can fire an alert.
//   - If a run exceeds `maxRuntime` minutes, Sentry creates a timeout issue.
//   - Exceptions thrown inside the handler are still captured normally
//     (Sentry's error path) AND mark the check-in as failed.
//
// Only wrap a slug that matches an actual schedule in `vercel.json` —
// otherwise Sentry will permanently see the cron as "never ran" and alert
// every cycle.

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { safeCompareSecret } from "@/lib/security/secrets";

type CronSchedule = { type: "crontab"; value: string };

export function withCronMonitor<H extends (req: Request) => Promise<Response>>(
  slug: string,
  schedule: string, // e.g. "0 2 * * *"
  handler: H,
  options?: { maxRuntimeMinutes?: number; checkinMarginMinutes?: number; timezone?: string },
): H {
  const wrapped = (async (req: Request) => {
    const response = await Sentry.withMonitor(
      slug,
      () => handler(req),
      {
        schedule: { type: "crontab", value: schedule } satisfies CronSchedule,
        // Default margins were too aggressive for crons triggered by n8n on
        // the Mac mini — every transient network blip or n8n-restart counted
        // as a missed check-in and Sentry treated it as a real failure
        // (JAVASCRIPT-NEXTJS-E4-N: 178 false-positive failures over 2 days
        // for cron-auto-complete-sessions). Loosened defaults give the n8n
        // trigger a realistic window without hiding sustained breakage:
        //   - checkinMargin 30min: 2× the longest typical n8n delay
        //   - failureIssueThreshold 5: a real outage misses 5+ runs in a row;
        //     a single transient hiccup no longer pages
        checkinMargin: options?.checkinMarginMinutes ?? 30,
        maxRuntime: options?.maxRuntimeMinutes ?? 5,
        timezone: options?.timezone ?? "UTC",
        failureIssueThreshold: 5,
        recoveryThreshold: 1,
      },
    );
    // On Vercel Functions the process can terminate as soon as we return,
    // before the SDK transport finishes posting the closing check-in. That
    // makes every successful run look like a timeout to Sentry. Block on
    // flush (≤2s) so the ok/error check-in lands before we exit.
    await Sentry.flush(2000);
    return response;
  }) as H;
  return wrapped;
}

/**
 * Like withCronMonitor, but performs the canonical dual-auth check FIRST and
 * only enters Sentry.withMonitor for authorized requests. A rejected (401)
 * request never reaches the monitor, so unauthorized hits can't register a
 * false-successful check-in (which would mask a misconfigured CRON_SECRET /
 * N8N_WEBHOOK_SECRET). Accepts either:
 *   - Authorization: Bearer ${CRON_SECRET}  (Vercel/operator), OR
 *   - X-N8N-Secret: ${N8N_WEBHOOK_SECRET}    (n8n trigger)
 */
export function withAuthedCronMonitor(
  slug: string,
  schedule: string,
  handler: (req: Request) => Promise<Response>,
  options?: { maxRuntimeMinutes?: number; checkinMarginMinutes?: number; timezone?: string },
): (req: Request) => Promise<Response> {
  const monitored = withCronMonitor(slug, schedule, handler, options);
  return async (req: Request) => {
    const cronAuth = req.headers.get("authorization");
    const expectedCron = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
    const cronOk = !!expectedCron && safeCompareSecret(cronAuth, expectedCron);
    const n8nSecret = req.headers.get("X-N8N-Secret");
    const n8nOk = safeCompareSecret(n8nSecret, process.env.N8N_WEBHOOK_SECRET);
    if (!cronOk && !n8nOk) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return monitored(req);
  };
}
