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
        checkinMargin: options?.checkinMarginMinutes ?? 2,
        maxRuntime: options?.maxRuntimeMinutes ?? 5,
        timezone: options?.timezone ?? "UTC",
        failureIssueThreshold: 2,  // need 2 consecutive misses before alerting
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
