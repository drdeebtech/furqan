// Sentry beforeSend hook — filters noise, redacts PII from URLs, and
// auto-enriches every event with deployment + error-class metadata so the
// issue feed is queryable by `error.kind`, `vercel.region`, `vercel.env`,
// `domain`, etc.
//
// Wired into:
//   - sentry.server.config.ts   (Sentry.init({ beforeSend }))
//   - sentry.edge.config.ts     (same)
//   - src/instrumentation-client.ts (same)
//
// Behavior is deliberately conservative: when in doubt, KEEP the event.
// Dropping a real bug because of an over-eager filter is much more expensive
// than letting one extension stack frame through.

import type { ErrorEvent, EventHint } from "@sentry/nextjs";

// Stack frames containing any of these strings strongly indicate the error
// originated in a browser extension or 3rd-party script we don't control.
// We drop those events because they're not actionable from our side.
const NOISE_STACK_PATTERNS = [
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
  // Grammarly's content-script crash signature.
  "Grammarly",
  // Honey, LastPass, AdGuard, uBlock — common commerce/ad extensions
  // that mutate the DOM and trip into our React tree.
  "honey/",
  "lastpass",
  "adguardx",
  // Sentry's own debug-id snippet echoing back as an "error" — happens when
  // the SDK runs in a tab with another Sentry SDK loaded by an extension.
  "_sentryDebugIds",
];

// Generic browser-noise messages that are not actionable. Match by exact
// equality; substrings risk over-matching real errors.
const NOISE_MESSAGE_EXACT = new Set<string>([
  "Non-Error promise rejection captured",
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications.",
  // Safari's bogus "Script error." on cross-origin scripts.
  "Script error.",
  // Supabase Auth — expected behavior, not a bug. Banned users hitting
  // /login should NOT page anyone; the user-facing error message handles
  // it correctly. Sentry was just collecting noise.
  "User is banned",
]);

// Error class names that are residue from the deleted Sentry-wizard test
// routes. The routes are 404 in production now, but if anyone ever re-adds
// them or replays an old event, drop these so they don't pollute the feed.
const NOISE_ERROR_NAMES = new Set<string>([
  "SentryExampleAPIError",
  "SentryExampleFrontendError",
]);

// Messages we want VISIBLE in Sentry (not filtered) but NOT triggering the
// high-priority alert rule. Downgraded to "warning" level. Use sparingly —
// each entry is a "this is signal, but cron/Telegram already pages on the
// underlying issue, no need to wake anyone up twice" decision.
const DEMOTE_TO_WARNING = [
  // Resend SMTP hiccups — the daily cron-email-health probe already pages
  // when the key is genuinely broken. A single "send failed" is usually a
  // transient blip.
  /^Error sending recovery email$/,
  /^Error sending confirmation email$/,
];

// Query parameters that may carry secrets/PII. Stripped from event request URLs.
const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "code",
  "secret",
  "password",
  "pwd",
  "key",
  "api_key",
  "apikey",
  "auth",
  "email",
  "e",
  "session_id",
]);

function shouldDrop(event: ErrorEvent, hint: EventHint): boolean {
  const ex = hint.originalException;
  // Exact-message noise (browser-injected, not actionable).
  const msg =
    (typeof ex === "object" && ex && "message" in ex && typeof (ex as { message?: unknown }).message === "string"
      ? (ex as { message: string }).message
      : undefined) ?? event.message;
  if (msg && NOISE_MESSAGE_EXACT.has(msg)) return true;

  // Error class names from removed Sentry-wizard test routes.
  const exType = event.exception?.values?.[0]?.type;
  if (exType && NOISE_ERROR_NAMES.has(exType)) return true;
  if (ex && typeof ex === "object" && "name" in ex) {
    const name = (ex as { name?: unknown }).name;
    if (typeof name === "string" && NOISE_ERROR_NAMES.has(name)) return true;
  }

  // Stack-frame noise.
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  for (const f of frames) {
    const filename = f.filename ?? "";
    const fn = f.function ?? "";
    for (const pattern of NOISE_STACK_PATTERNS) {
      if (filename.includes(pattern) || fn.includes(pattern)) return true;
    }
  }

  return false;
}

// Downgrade certain expected-but-noteworthy errors from "error" to "warning"
// level so the high-priority alert rule (`level:error AND priority:high`)
// stops paging on them, while keeping them visible in the issue feed.
function maybeDemote(event: ErrorEvent, hint: EventHint): void {
  const ex = hint.originalException;
  const msg =
    (typeof ex === "object" && ex && "message" in ex && typeof (ex as { message?: unknown }).message === "string"
      ? (ex as { message: string }).message
      : undefined) ?? event.message ?? "";
  for (const pattern of DEMOTE_TO_WARNING) {
    if (pattern.test(msg)) {
      event.level = "warning";
      return;
    }
  }
}

function deriveErrorKind(event: ErrorEvent, hint: EventHint): string | undefined {
  const ex = hint.originalException;
  if (ex && typeof ex === "object" && "name" in ex) {
    const name = (ex as { name?: unknown }).name;
    if (typeof name === "string" && name.length > 0 && name !== "Error") {
      // FooBarError → "foo-bar"
      return name
        .replace(/Error$/, "")
        .replace(/([a-z])([A-Z])/g, "$1-$2")
        .toLowerCase()
        || undefined;
    }
  }
  // Fallback: top exception type from event payload.
  const type = event.exception?.values?.[0]?.type;
  if (type && type !== "Error") {
    return type
      .replace(/Error$/, "")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase()
      || undefined;
  }
  return undefined;
}

function redactRequestUrl(event: ErrorEvent): void {
  const url = event.request?.url;
  if (!url || typeof url !== "string") return;
  try {
    const u = new URL(url);
    let mutated = false;
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        u.searchParams.set(key, "[redacted]");
        mutated = true;
      }
    }
    if (mutated && event.request) {
      event.request.url = u.toString();
    }
  } catch {
    // URL parsing failure — leave the original alone, not worth blowing up beforeSend.
  }
}

function enrichTags(event: ErrorEvent, hint: EventHint): void {
  event.tags = event.tags ?? {};
  const kind = deriveErrorKind(event, hint);
  if (kind) event.tags["error.kind"] = kind;

  // VERCEL_REGION is set on production functions; VERCEL_URL is the
  // deployment hostname; VERCEL_ENV is "production" | "preview" | "development".
  // These are also exposed as NEXT_PUBLIC_* on the client, so the same hook
  // works in both environments.
  const region = process.env.VERCEL_REGION ?? process.env.NEXT_PUBLIC_VERCEL_REGION;
  const url = process.env.VERCEL_URL ?? process.env.NEXT_PUBLIC_VERCEL_URL;
  const env = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV;
  if (region) event.tags["vercel.region"] = region;
  if (url) event.tags["vercel.url"] = url;
  if (env) event.tags["vercel.env"] = env;
}

export function beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
  if (shouldDrop(event, hint)) return null;
  enrichTags(event, hint);
  redactRequestUrl(event);
  maybeDemote(event, hint);
  return event;
}

// Patterns the browser SDK can drop *before* invoking beforeSend. Cheaper
// than relying on beforeSend alone — these match the message OR the bare
// error type and fail fast.
export const CLIENT_IGNORE_ERRORS: (string | RegExp)[] = [
  "Non-Error promise rejection captured",
  /ResizeObserver loop /,
  "Script error.",
  // Bursts from Honey/LastPass when they fail to inject.
  /honey: failed to inject/i,
  // Vercel BotID's expected "no-bot" exception when a real human passes —
  // some integrations still throw a synthetic Error to bail the hot path.
  /^botid: ok$/i,
];
