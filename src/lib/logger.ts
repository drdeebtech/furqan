import * as Sentry from "@sentry/nextjs";

/**
 * Centralized error logger. Routes to Sentry when SENTRY_DSN is set,
 * falls back to console.error otherwise. Use this instead of `console.error`
 * in server code so ops sees a grouped, alertable error instead of a noisy
 * function log entry.
 *
 * Client-side use is also safe — Sentry's browser SDK initializes the same way.
 */
export function logError(message: string, error: unknown, context?: Record<string, unknown>): void {
  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(error, {
      extra: { message, ...(context ?? {}) },
      tags: context?.tag ? { tag: String(context.tag) } : undefined,
    });
    return;
  }
  // Fallback when Sentry is not configured (dev / preview without DSN)
  console.error(message, error, context);
}

/**
 * Non-error warnings (missing optional config, skipped side-effects).
 * These never throw and don't page anyone — just visible in logs.
 */
export function logWarn(message: string, context?: Record<string, unknown>): void {
  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureMessage(message, { level: "warning", extra: context });
    return;
  }
  console.warn(message, context);
}
