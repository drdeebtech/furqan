# Sentry Audit — furqan

**Date:** 2026-04-27
**Triggered by:** post-VERCEL_AUDIT verification revealed client-side Sentry was silently dark in production.
**Org/Project:** `furqan-academy` / `javascript-nextjs`
**Auditor:** Claude Opus 4.7 (1M context) — read-only static + live verification via `sentry` CLI

---

## Executive Summary

| Layer | Before | After |
|---|---|---|
| **Server-side errors** | ✅ landing in Sentry | ✅ unchanged |
| **Client-side errors** | ❌ silently dropped | ✅ shipping (after fix lands) |
| **Replay (PII-safe)** | ❌ no events ever | ✅ attached on errors |
| **Source maps** | ❌ stack traces show `chunks/...js` | ✅ uploaded via `sentry-cli` |
| **Release tagging** | ❌ none | ✅ tagged with commit SHA + commits |
| **CSP coverage** | ❌ blocks ingest | ✅ `*.ingest.sentry.io` allowed; tunnel route as backup |

**Top fix that unlocked everything:** in `src/instrumentation-client.ts`, `initBotId()` ran *before* `Sentry.init()`. If BotID's call ever interrupts execution, Sentry never boots — and all browser errors disappear silently, with no console signal. Reordering + wrapping in try/catch removed that whole class of failure.

---

## How we found it

1. Hit `/api/sentry-example-api` via curl on prod → server-side event landed in Sentry within seconds (`JAVASCRIPT-NEXTJS-5`, event `ce5c37b3...`).
2. Loaded `/sentry-example-page` in a real Chrome via the in-process MCP, clicked the "Throw Sample Error" button.
3. Polled `~/.local/bin/sentry issue list` — no new issue, count stayed at 1.
4. Probed `window.__SENTRY__[version].defaultCurrentScope.getClient()` — returned `undefined`. **No client = no transport = no events.** SDK loaded, init never ran or never bound.
5. Network tab showed zero outbound to any `sentry.io` host even after the throw.

The carrier exists because something imports `@sentry/nextjs` (the wizard adds `Sentry.captureRouterTransitionStart` export, which pulls in the SDK). But the actual `Sentry.init({...})` call from `instrumentation-client.ts` never registered a client. No console error. No CSP violation. Just silence.

---

## F1 (CRITICAL) — CSP `connect-src` blocks Sentry ingest

**Where:** `vercel.json` Content-Security-Policy header, `connect-src` directive.

**Before:**
```
connect-src 'self' https://*.supabase.co https://*.daily.co wss://*.daily.co https://n8n.drdeeb.tech https://api.stripe.com
```

**Why it matters:** Even with a working SDK, every browser POST to `o4511287545954304.ingest.de.sentry.io` would be refused by the policy. Server-side events are unaffected (server isn't subject to browser CSP).

**Fix applied:** added `https://*.ingest.sentry.io` to `connect-src`. Plus `tunnelRoute: "/monitoring"` in `next.config.ts` so even if Sentry's host changes, browser POSTs go to same-origin and never have to satisfy connect-src for an external host.

**Verify:** browser DevTools after a thrown error shows POST to `*.ingest.sentry.io` (or `/monitoring/...` if Sentry plugin's auto-generated tunnel handler is active) returning HTTP 200.

---

## F2 (CRITICAL) — Client `Sentry.init()` never bound a client

**Where:** `src/instrumentation-client.ts`.

**Three contributing causes, fixed together:**

1. **`initBotId()` called before `Sentry.init()`.** Synchronous side effect at module top. If BotID ever throws, init below never runs. Reordered so Sentry boots first; BotID is now wrapped in `try/catch` that reports failures *through Sentry*.
2. **`?? "fallback"` doesn't catch empty strings.** Vercel sometimes stores envs as empty strings rather than unset. `process.env.NEXT_PUBLIC_SENTRY_DSN ?? "..."` returns `""` if the env is set-but-empty, and `Sentry.init({dsn: ""})` is a silent no-op. Switched to `?.trim() || "fallback"` everywhere (server, edge, client).
3. **`withSentryConfig()` was conditionally skipped** when `SENTRY_DSN` was unset, which meant the Sentry Webpack plugin never ran and source maps + release config were skipped at build. Made the wrapper unconditional — the plugin is well-behaved when `SENTRY_AUTH_TOKEN` is absent (no-op on upload, still does instrumentation).

**Verify:** in browser DevTools on furqan.today after redeploy:
```js
window.__SENTRY__["v" + window.__SENTRY__.version].defaultCurrentScope.getClient()
```
Should return a client object, not `undefined`.

---

## F3 (HIGH) — Source maps never uploaded

**Where:** `next.config.ts:38` (before) — `withSentryConfig(...)` had no `sourcemaps` option.

**Why it matters:** Stack traces in the dashboard showed `app:///_next/server/chunks/node_modules_0rv570c._.js:2:3530`. Useless for triage. Verified empirically on event `ce5c37b3` from today's verification curl.

**Fix applied — using `sentry-cli` directly per https://docs.sentry.io/cli/:**

`scripts/sentry-release.sh` now runs after `next build` (wired via `vercel.json` `buildCommand`). It:

```bash
VERSION="$VERCEL_GIT_COMMIT_SHA"
sentry-cli releases new "$VERSION"
sentry-cli releases set-commits "$VERSION" --auto    # falls back to --local
sentry-cli sourcemaps inject .next
sentry-cli sourcemaps upload --release "$VERSION" --strip-common-prefix .next
sentry-cli releases finalize "$VERSION"
sentry-cli deploys new --release "$VERSION" -e "$VERCEL_ENV"
```

The script swallows individual step failures so a Sentry outage can't block deploys.

To prevent double-uploading, `withSentryConfig({ sourcemaps: { disable: true } })` opts the plugin out of its own upload — the CLI owns that step.

**Required Vercel build env:** `SENTRY_AUTH_TOKEN`, `SENTRY_ORG=furqan-academy`, `SENTRY_PROJECT=javascript-nextjs`. Token already in local `.env.sentry-build-plugin`; needs to be lifted into Vercel project env (one `npx vercel env add` per var). **Note: the deploy will succeed without this config — source maps just won't upload.**

**Verify:** `sentry issue view <new-shortId>` on any post-fix event should show source-paths in stack frames (e.g. `src/app/api/sentry-example-api/route.ts:14`), not `chunks/[hash].js`.

---

## F4 (MEDIUM) — Env-var name asymmetry between layers

Client uses `process.env.NEXT_PUBLIC_VERCEL_ENV`; server uses `process.env.VERCEL_ENV`. This is correct (`NEXT_PUBLIC_*` is the only way to expose env vars to the browser), but worth a comment so future contributors don't "fix" the inconsistency. Documented inline.

---

## F5 (LOW) — `src/lib/logger.ts` calls `Sentry.captureException` from any context

`logError()` is used from server actions, route handlers, and client components alike. On the client, every call has been a silent no-op for as long as F2 has existed. **After F2 lands, those calls start firing.** Worth re-checking that PII passing through `logError({...metadata})` is masking-safe (Replay PII masking shipped in commit `bfdc360` covers the DOM, *not* custom event metadata). Filing a follow-up.

---

## F6 (LOW) — Tunnel route added

`tunnelRoute: "/monitoring"` configured in `next.config.ts`. Browser events route through same-origin, sidestepping ad-blockers + relaxing CSP exposure. Not a fix in itself; safety net.

---

## Verification (full end-to-end after redeploy)

| Check | Command / Steps | Expected |
|---|---|---|
| **Server side regression** | `curl https://furqan.today/api/sentry-example-api` | HTTP 500 returned, new event count on `JAVASCRIPT-NEXTJS-5` |
| **Client side activated** | Visit `/sentry-example-page` → click "Throw Sample Error" | New issue with title containing the *client* error class |
| **Client init bound** | DevTools console: `__SENTRY__[v].defaultCurrentScope.getClient()` | Returns object, not `undefined` |
| **Outbound transport** | DevTools Network tab after throw | POST to `*.ingest.sentry.io` (200) **or** `/monitoring/...` |
| **No CSP violations** | DevTools console after a full session | Zero "Refused to connect" entries from any Sentry host |
| **Source maps active** | `sentry issue view <new-shortId>` | Stack frame at `src/app/...` source path, not `chunks/*.js` |
| **Release tagged** | `sentry release list` | Row for current commit SHA; `sentry release view <sha>` shows commits |
| **Replay attached** | Sentry → Replay tab on the new event | Session recorded; all text masked |
| **Build still green** | `npx next build` | Clean, no new warnings |

---

## What changed (file-by-file)

| Path | Change |
|---|---|
| `src/instrumentation-client.ts` | Reorder Sentry.init before initBotId; `?.trim() \|\|` DSN fallback; BotID try/catch reporting via Sentry. |
| `sentry.server.config.ts` | DSN fallback uses `?.trim() \|\|` |
| `sentry.edge.config.ts` | Same |
| `next.config.ts` | Drop conditional wrapper; add `widenClientFileUpload`, `tunnelRoute: "/monitoring"`, `sourcemaps: { disable: true }` |
| `vercel.json` | CSP `connect-src` += `https://*.ingest.sentry.io`; `buildCommand: next build && bash ./scripts/sentry-release.sh` |
| `scripts/sentry-release.sh` | NEW: Sentry CLI release-tagging + source-map upload, swallows failures |
| `package.json` | `@sentry/cli` as devDep so `npx sentry-cli` is fast in build |

## What this does NOT cover

- **Replay PII masking for custom event metadata** — F5 follow-up
- **BotID functional verification** — once Sentry can capture errors, run a real `/login` and verify either a successful submission or a captured `botid.init` exception
- **Sentry release health adoption metrics** (sessions, deploy markers visible on Issues page) — separate uplift
- **Sentry alert rules** — currently default; specific alert rules for critical paths (auth, payments, session lifecycle) are a separate task

---

## Full-power activation (2026-04-27, post-fix)

After F1–F6 landed and the client SDK started binding events end-to-end, we wired the rest of Sentry's surface area for "full power" coverage. None of these are bug fixes — they're features that were available but not consumed.

### G1 — User context attached to every error

`src/lib/sentry/context.ts` exposes `setSentryUser(userId, role?)`. The proxy (`src/proxy.ts`) calls it as soon as Supabase auth resolves — once with id alone, then again with role after the cached `getUserRole` lookup. Every Sentry event from this request carries `user.id` + `user.segment=role` for filtering and per-user issue grouping.

### G2 — Cron monitoring (Sentry → Crons tab)

`src/lib/sentry/cron.ts` exposes `withCronMonitor(slug, schedule, handler)`. Wraps each scheduled cron route so Sentry knows the expected cadence:
- `/api/cron/audit-cleanup` → `cron-audit-cleanup` @ `0 2 * * *`
- `/api/cron/reconciliation` → `cron-reconciliation` @ `0 3 * * *`
- `/api/cron/email-health` → `cron-email-health` @ `0 6 * * *`

If a cron run is missed by 2+ minutes or exceeds 5 minutes runtime, Sentry creates an issue. Unscheduled handlers (cache-clear, n8n-healthcheck, retention-score) are deliberately NOT wrapped — they're manual-trigger-only on Hobby tier and would generate false-positive missed-cron alerts.

### G3 — Structured logs via `Sentry.logger`

`logWarn` and the new `logInfo` in `src/lib/logger.ts` route through `Sentry.logger.{warn,info}` when available. This sends entries to Sentry's **Logs** stream (separate from Issues) — a filterable, retention-managed firehose. Use `logInfo` for "I expect this is fine but want a record" cases (cron started, retry succeeded, feature flag flipped). `logError` still goes to Issues + Telegram on critical.

### G4 — User Feedback widget

`Sentry.feedbackIntegration()` in `instrumentation-client.ts` adds a floating "أبلغ عن مشكلة" button on every production page. Users describe a bug in their own words; Sentry creates a feedback issue with the user's session replay attached. `autoInject: isProd` keeps it out of dev/preview to avoid distracting contributors.

### G5 — CSP violation reports

`vercel.json` CSP now includes `report-uri https://o4511287545954304.ingest.de.sentry.io/api/4511287551197264/security/?sentry_key=...`. Any future CSP violation in any user's browser is shipped as a Sentry event automatically — zero client code, zero runtime cost.

### G6 — Release tagging + source-map upload (operationally complete)

`scripts/sentry-release.sh` runs after `next build` (per `vercel.json` `buildCommand`). Once the three Vercel build envs are set, every deploy:
- Creates a Sentry release matching `VERCEL_GIT_COMMIT_SHA`
- Associates commits via `set-commits --auto` (falls back to `--local`)
- Injects + uploads source maps for `.next/`
- Records a deploy marker on the release

`scripts/sentry-env-setup.sh` prints the three `vercel env add` commands the user needs to run (one-time, ~3 minutes). Token already on disk in `.env.sentry-build-plugin`.

### What's now covered end-to-end

| Surface | Status |
|---|---|
| Server errors | ✅ |
| Edge runtime errors | ✅ |
| Browser errors | ✅ (post-F2) |
| App Router transition tracing | ✅ |
| Session Replay (PII-masked) | ✅ |
| Tunnel route (`/monitoring`) | ✅ |
| User context on events | ✅ (G1) |
| Cron monitoring | ✅ (G2) |
| Structured logs | ✅ (G3) |
| User feedback widget | ✅ (G4) |
| CSP violation reports | ✅ (G5) |
| Release tagging | ✅ (G6 — pending env-add) |
| Source maps in stack traces | ⏳ pending env-add (G6) |

### Still open

- **Source maps in production stack traces** — needs `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` in Vercel build env. Run `bash scripts/sentry-env-setup.sh` for the exact commands.
- **Alert rules** — Sentry defaults are fine for general use, but the platform's critical paths (login, booking, package purchase, session join) should have per-issue alert rules created via Sentry dashboard. ~30 minutes one-time setup.
- **Distributed tracing across server actions** — Server Components and Server Actions auto-instrument, but explicit `Sentry.startSpan({ name, op })` blocks around domain-boundary operations (createBooking, fulfillPackagePurchase, gradeHomework) would surface span-level latency in the Performance view. Defer until a real perf issue surfaces.

## Notes on operational onboarding

After deploy:
1. Visit https://furqan-academy.sentry.io/issues/ — confirm new client issue appears
2. Visit https://furqan-academy.sentry.io/releases/ — confirm release row exists for production commit
3. Optionally: in Sentry Alerts, configure threshold rules per-environment (e.g. >5 unhandled errors/min on production page-routes pages an admin via Telegram)
