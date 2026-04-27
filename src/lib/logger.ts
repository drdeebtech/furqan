import * as Sentry from "@sentry/nextjs";

// Keys we promote from the loose context into Sentry tags (filterable in the
// issue feed) instead of into extras (which are not). Everything else stays
// in extras as-is.
const TAG_KEYS = new Set(["tag", "domain", "route", "kind", "actionName", "component", "severity"]);

function splitTagsAndExtras(context: Record<string, unknown> | undefined) {
  if (!context) return { tags: undefined, extras: undefined };
  const tags: Record<string, string> = {};
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (v === undefined || v === null) continue;
    if (TAG_KEYS.has(k)) tags[k] = typeof v === "string" ? v : String(v);
    else extras[k] = v;
  }
  return {
    tags: Object.keys(tags).length > 0 ? tags : undefined,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
  };
}

/**
 * Centralized error logger. Routes to Sentry when SENTRY_DSN is set,
 * falls back to console.error otherwise. Use this instead of `console.error`
 * in server code so ops sees a grouped, alertable error instead of a noisy
 * function log entry.
 *
 * Promoted-to-tag context keys (filterable in Sentry):
 *   tag, domain, route, kind, actionName, component, severity
 * Everything else lands in extras.
 *
 * Client-side use is also safe — Sentry's browser SDK initializes the same way.
 */
export function logError(message: string, error: unknown, context?: Record<string, unknown>): void {
  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
    const { tags, extras } = splitTagsAndExtras(context);
    Sentry.captureException(error, {
      extra: { message, ...(extras ?? {}) },
      tags,
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
  // Always leave a breadcrumb so the next captured error has a trail of the
  // "I expect this is fine" notes that ran beforehand.
  Sentry.addBreadcrumb?.({
    category: "log",
    level: "info",
    message,
    data: context,
  });

  const sentryLogger = Sentry.logger as undefined | { info?: (msg: string, attrs?: Record<string, unknown>) => void };
  if (sentryLogger?.info) {
    sentryLogger.info(message, (context ?? {}) as Record<string, unknown>);
    return;
  }
  if (process.env.NODE_ENV !== "production") {
    console.info(message, context);
  }
}
