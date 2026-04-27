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
  } else {
    // Fallback when Sentry is not configured (dev / preview without DSN)
    console.error(message, error, context);
  }

  // Critical-tier errors also fire a Telegram alert so the operator sees them
  // immediately instead of waiting to look at logs. Best-effort — never throws.
  if (context?.severity === "critical" && process.env.TG_BOT_TOKEN && process.env.TG_ADMIN_CHAT_ID) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const escape = (s: string) =>
      s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const text = `🚨 <b>Critical error</b>\n\n<b>Message:</b> ${escape(message)}\n<b>Error:</b> ${escape(errMsg)}\n<b>Tag:</b> ${escape(String(context.tag ?? "untagged"))}`;
    void fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TG_ADMIN_CHAT_ID, text, parse_mode: "HTML" }),
    }).catch(() => { /* don't double-fail */ });
  }
}

/**
 * Non-error warnings (missing optional config, skipped side-effects).
 * These never throw and don't page anyone — just visible in logs.
 *
 * Routes through Sentry's structured logger when available (server config
 * has `enableLogs: true`), so messages land in Sentry → Logs tab as a
 * filterable stream rather than as one-off issues.
 */
export function logWarn(message: string, context?: Record<string, unknown>): void {
  const sentryLogger = Sentry.logger as undefined | { warn?: (msg: string, attrs?: Record<string, unknown>) => void };
  if (sentryLogger?.warn) {
    sentryLogger.warn(message, (context ?? {}) as Record<string, unknown>);
    return;
  }
  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureMessage(message, { level: "warning", extra: context });
    return;
  }
  console.warn(message, context);
}

/**
 * Informational log line. Goes to Sentry → Logs (NOT Issues), so heavy use
 * doesn't drown the issue feed. Use for "I expect this is fine but want
 * a record": cron started/finished, feature flag flipped, retry succeeded.
 */
export function logInfo(message: string, context?: Record<string, unknown>): void {
  const sentryLogger = Sentry.logger as undefined | { info?: (msg: string, attrs?: Record<string, unknown>) => void };
  if (sentryLogger?.info) {
    sentryLogger.info(message, (context ?? {}) as Record<string, unknown>);
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.info(message, context);
  }
}
