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
  // Next.js stale Server Action chunk after a deploy. The client-side
  // chunk hash no longer exists on the server post-deploy; the user's
  // next click resolves it (chunk reload). Not actionable from code —
  // the deploy itself caused it. JAVASCRIPT-NEXTJS-E4-W.
  "Failed to find Server Action. This request might be from an older or newer deployment.",
  // Supabase Auth refresh-token error class. Fires when a user opens a
  // long-stale tab, switches browsers, or clears cookies between visits.
  // The auth code already redirects to /login; Sentry was just logging
  // a normal user-side state. JAVASCRIPT-NEXTJS-E4-12 / E4-13.
  "Invalid Refresh Token: Refresh Token Not Found",
  // CSP rejection of Vercel preview-toolbar script. The toolbar lives on
  // vercel.live and only loads on preview/PR builds. We don't ship it to
  // production; the browser CSP error from a visitor with the toolbar in
  // localStorage is not actionable. JAVASCRIPT-NEXTJS-E4-11.
  "Blocked 'script' from 'vercel.live'",
]);

// Substrings that match noise messages where the full text varies (provider
// adds context after the diagnostic core). Match cautiously — keep the
// substring long enough that a real bug with similar wording still surfaces.
const NOISE_MESSAGE_INCLUDES = [
  // Supabase Auth PKCE storage miss. The verifier lives in localStorage; if
  // the user opened the OAuth tab and finished the redirect on a different
  // device or after clearing storage, the verifier is gone. The auth code
  // logs the user out and shows a recoverable error. Not a code bug.
  // JAVASCRIPT-NEXTJS-E4-X.
  "PKCE code verifier not found in storage",
];

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
  // BotID false positives — Vercel's bot detector occasionally flags real
  // users (Safari/Mac in Kuwait was the canonical case 2026-05-01). The
  // login/register form already returns a recoverable error message so the
  // user can retry; we still want VISIBLE breadcrumbs to spot a sustained
  // spike but a single block shouldn't page anyone.
  // login.bot_bypass / register.bot_bypass are intentional admin-allow-list
  // bypasses (BotID working as designed); demote them too so they don't
  // burn the alert pager when an admin signs in. JAVASCRIPT-NEXTJS-E4-C/V/Z.
  /^(login|register)\.bot_(blocked|bypass)$/,
  // OAuth callback called without a `code` query param — typically a user
  // hitting the back button mid-flow, denying consent, or a flaky network
  // dropping the redirect. The handler already redirects to /login with a
  // user-readable error code; not a code bug.
  /^oauth\.callback\.missing_code$/,
];

// Routes that use React's `useActionState` hook (Next 15+) rather than a
// fetchServerAction call. The form-action transport differs from server
// actions, but a Safari WebKit network abort still surfaces as
// "TypeError: Load failed". The existing fetchServerAction filter doesn't
// catch these because the stack trace lacks `server-action-reducer` /
// `fetchServerAction` markers. Add new useActionState pages here when
// they ship.
const USE_ACTION_STATE_ROUTES = new Set<string>([
  "/login",
  "/register",
  "/forgot-password",
]);

// Hydration mismatch messages — these fire when server-rendered HTML differs
// from client-rendered HTML. The most common cause in Furqan is
// toLocaleDateString/toLocaleTimeString producing locale-dependent output
// that varies between Node.js (server) and Safari/Chrome (client).
// These are cosmetic mismatches, not real bugs, and are safe to drop entirely.
const HYDRATION_MESSAGES = new Set<string>([
  "Hydration failed - the server rendered HTML didn't match the client.",
  "Text content did not match. Server: \"\" Client: \"\"",
  "There was an error while hydrating. Because this error occurred outside of a Suspense boundary, the whole route will be redirected to the error page.",
]);

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
  "otp",
  "e",
  "session_id",
]);

type RawStackFrame = {
  filename?: string;
  function?: string;
  context?: Array<[number, string]>;
};

// A frame is "framework" when its filename points at Next.js build output,
// node_modules, or a Node.js builtin. Sentry's in_app heuristic marks
// `_next/static/chunks/*` as in_app:true — minified react-dom living there
// looks like user code, but isn't. Path-based detection is the reliable
// signal for "this stack is 100% framework, no user code involved."
function isFrameworkFrame(filename: string): boolean {
  if (!filename) return false;
  return (
    filename.includes("/_next/") ||
    filename.includes("/node_modules/") ||
    filename.startsWith("node:") ||
    filename.startsWith("webpack-internal:") ||
    filename.startsWith("next/dist/")
  );
}

function allFramesAreFramework(frames: { filename?: string }[]): boolean {
  if (frames.length === 0) return false;
  return frames.every((f) => isFrameworkFrame(f.filename ?? ""));
}

function getRawStackFrames(event: ErrorEvent): RawStackFrame[] {
  const exception = event.exception?.values?.[0] as { rawStacktrace?: { frames?: RawStackFrame[] } } | undefined;
  return exception?.rawStacktrace?.frames ?? [];
}

// Detect Mobile Safari versions with the documented service-worker network-
// abort bug. iOS 15-16 had an ITP issue where backgrounded tabs would silently
// abort in-flight fetches; the abort surfaces in user code as either
// "Rendered more hooks" (React's hook-recovery path) or "TypeError: Load
// failed" (the raw fetch failure). Safari 17 (iOS 17) shipped the fix.
// We've seen zero matching real bugs over 6+ months of these events.
function isOldMobileSafari(event: ErrorEvent): boolean {
  const browser = (event.contexts as { browser?: { name?: string; version?: string } } | undefined)?.browser;
  if (!browser || browser.name !== "Mobile Safari") return false;
  const major = parseInt((browser.version ?? "").split(".")[0] ?? "", 10);
  if (Number.isNaN(major)) return false;
  return major < 17;
}

function rawFrameContextIncludesServerActionFetch(frame: RawStackFrame): boolean {
  const contextText = frame.context?.map(([, line]) => line).join("\n") ?? "";
  if (!contextText.includes("fetch(e.canonicalUrl")) return false;

  return (
    contextText.includes("NEXT_ACTION") ||
    contextText.includes("unrecognizedActionHeader") ||
    contextText.includes("A.headers.get(u.NEXT_A")
  );
}

function shouldDrop(event: ErrorEvent, hint: EventHint): boolean {
  const ex = hint.originalException;
  const exceptionValue = event.exception?.values?.[0]?.value;
  // Exact-message noise (browser-injected, not actionable). Some browser
  // events arrive with `event.message === ""` even though the exception value
  // is populated, so fall back all the way to the captured exception payload.
  const msg =
    (typeof ex === "object" && ex && "message" in ex && typeof (ex as { message?: unknown }).message === "string"
      ? (ex as { message: string }).message
      : undefined) || event.message || exceptionValue;
  if (msg && NOISE_MESSAGE_EXACT.has(msg)) return true;

  // Substring-match drops for messages where the provider tacks variable
  // context after a stable diagnostic core (e.g. Supabase Auth's PKCE
  // error with framework-recommendation text appended).
  if (msg) {
    for (const needle of NOISE_MESSAGE_INCLUDES) {
      if (msg.includes(needle)) return true;
    }
  }

  // Hydration mismatches — cosmetic server/client text differences (typically
  // locale-dependent date formatting). Not actionable, safe to drop entirely.
  // Sentry issue JAVASCRIPT-NEXTJS-J.
  if (msg && HYDRATION_MESSAGES.has(msg)) return true;

  // Error class names from removed Sentry-wizard test routes.
  const exType = event.exception?.values?.[0]?.type;
  if (exType && NOISE_ERROR_NAMES.has(exType)) return true;
  if (ex && typeof ex === "object" && "name" in ex) {
    const name = (ex as { name?: unknown }).name;
    if (typeof name === "string" && NOISE_ERROR_NAMES.has(name)) return true;
  }

  // Stack-frame noise.
  const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
  const rawFrames = getRawStackFrames(event);
  for (const f of frames) {
    const filename = f.filename ?? "";
    const fn = f.function ?? "";
    for (const pattern of NOISE_STACK_PATTERNS) {
      if (filename.includes(pattern) || fn.includes(pattern)) return true;
    }
  }

  // Network-jitter noise from Next.js Server Actions. When a user's
  // connection drops mid-request, the App Router's fetchServerAction
  // throws `TypeError: Load failed` and sometimes triggers a sibling
  // `Rendered more hooks than during the previous render` from the
  // reducer's recovery path — both with zero in-app frames (everything
  // is in node_modules/next/...). In production, beforeSend may only see
  // the minified client chunk frame before Sentry symbolicates it server-side,
  // so also inspect rawStacktrace context for the server-action fetch snippet.
  // Real fix is on the user's network, not in our code, and the page
  // redirects/reloads cleanly anyway. Drop both signatures.
  // Match `Load failed` exactly OR with a URL appended ("Load failed
  // (www.furqan.today)"), which is how some Safari builds + Sentry's
  // own URL enrichment surface the same fingerprint.
  // JAVASCRIPT-NEXTJS-E4-19 / E4-Y leaked from the appended-URL form.
  if (exType === "TypeError" && typeof msg === "string" && msg.startsWith("Load failed")) {
    for (const f of frames) {
      const filename = f.filename ?? "";
      const fn = f.function ?? "";
      if (
        filename.includes("server-action-reducer") ||
        fn === "fetchServerAction"
      ) return true;
    }
    for (const f of rawFrames) {
      const filename = f.filename ?? "";
      const fn = f.function ?? "";
      if (
        filename.includes("server-action-reducer") ||
        fn === "fetchServerAction" ||
        rawFrameContextIncludesServerActionFetch(f)
      ) return true;
    }
    // Catch-all for iOS Safari builds where Sentry only sees minified frames
    // without the server-action-reducer marker. "Load failed" + zero in-app
    // code = WebKit aborted a network request (user navigated away mid-fetch,
    // wifi blip). Not actionable. JAVASCRIPT-NEXTJS-E4-3 was leaking here.
    if (allFramesAreFramework(frames)) return true;
    // Route-based catch: useActionState pages don't go through
    // fetchServerAction, so the marker checks above miss their network
    // aborts. The transaction tag is the route that fired the form.
    if (event.transaction && USE_ACTION_STATE_ROUTES.has(event.transaction)) return true;
  }
  if (
    msg === "Rendered more hooks than during the previous render." ||
    msg === "Minified React error #310; visit https://react.dev/errors/310 for the full message or use the non-minified dev environment for full errors and additional helpful warnings."
  ) {
    // If 100% of frames are framework (next chunks / node_modules / node:),
    // this is the same network-recovery class as above — not a user-code
    // hooks bug. Use path-based detection because Sentry marks _next/
    // chunks as in_app:true, so a flag-based check leaks noise through.
    if (allFramesAreFramework(frames)) return true;
    // iOS 15-16 Mobile Safari has a documented service-worker abort bug
    // that surfaces as the React hook-recovery error. Safari 17+ shipped
    // the fix. We've never seen a real user-code hook bug from old Safari
    // here, so drop when both signals match.
    if (isOldMobileSafari(event)) return true;
  }

  // Connection-abort errors from node:_http_server (abortIncoming /
  // socketOnClose ECONNRESET) — fired when the client TCP-disconnects
  // mid-request. Always surface as zero-in-app-frame stacks rooted in
  // node:_http_server. Not actionable: nothing in the app caused or can
  // prevent it. Filter regardless of environment (was previously scoped
  // to local dev only — JAVASCRIPT-NEXTJS-E4-1 leaked through from prod).
  if (msg === "aborted" && exType === "Error" && frames.length > 0) {
    const allNodeFrames = frames.every((f) => (f.filename ?? "").startsWith("node:"));
    const noInAppFrames = !frames.some((f) => f.in_app === true);
    if (allNodeFrames && noInAppFrames) return true;
  }

  // RSC stream connection abort — fires when the user navigates away (or
  // loses network) mid-stream. Surfaces as `Error: Connection closed.` from
  // react-server-dom-{turbopack,webpack}-client.browser.production.js with
  // mechanism=auto.browser.global_handlers.onunhandledrejection. Not
  // actionable from our code; React itself is just reporting that the
  // streaming response was cut short. Match on exact message + stack frame
  // path so a real "Connection closed" from elsewhere still surfaces.
  // JAVASCRIPT-NEXTJS-E4-Q / E4-S.
  if (msg === "Connection closed.") {
    for (const f of frames) {
      if ((f.filename ?? "").includes("react-server-dom-")) return true;
    }
    for (const f of rawFrames) {
      if ((f.filename ?? "").includes("react-server-dom-")) return true;
    }
    // Catch-all: when stack symbolication is partial in production, frames
    // arrive without the react-server-dom marker (just minified chunk
    // names). If 100% are framework, this is the same RSC-stream-abort
    // class as above.
    if (allFramesAreFramework(frames)) return true;
  }

  // React DOM reconciliation errors caused by external DOM mutation —
  // primarily Chrome/Edge auto-translate moving nodes that React then
  // tries to remove or update. The stack is 100% react-dom internals
  // (lr/li commit-deletion paths in the minified chunk), zero in-app
  // frames. Not actionable from our code; the route error boundary
  // catches it user-side. JAVASCRIPT-NEXTJS-E4-6 was the canonical case.
  // Match on either NotFoundError name + removeChild message, OR the
  // sibling "insertBefore" / "Failed to execute" patterns from the same
  // class of bug. Require zero in-app frames so a real bug in our code
  // that happens to call removeChild still surfaces.
  if (
    exType === "NotFoundError" &&
    typeof msg === "string" &&
    (msg.includes("removeChild") || msg.includes("insertBefore"))
  ) {
    if (allFramesAreFramework(frames)) return true;
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
  // Hydration mismatches from locale-dependent date formatting (JAVASCRIPT-NEXTJS-J).
  // The server and client render slightly different text for toLocaleDateString/toLocaleTimeString.
  "Hydration failed - the server rendered HTML didn't match the client.",
  "There was an error while hydrating. Because this error occurred outside of a Suspense boundary, the whole route will be redirected to the error page.",
  // Stale Server Action chunk after deploy — the user clicked a button
  // that referenced a chunk hash from the previous deploy. Self-heals on
  // refresh; not actionable. JAVASCRIPT-NEXTJS-E4-W.
  "Failed to find Server Action. This request might be from an older or newer deployment.",
  // CSP block of Vercel preview toolbar from production builds.
  // JAVASCRIPT-NEXTJS-E4-11.
  "Blocked 'script' from 'vercel.live'",
  // Supabase Auth refresh-token / PKCE storage misses — user-side state,
  // not a code bug. JAVASCRIPT-NEXTJS-E4-12 / E4-13 / E4-X.
  /Invalid Refresh Token: Refresh Token Not Found/,
  /PKCE code verifier not found in storage/,
];
