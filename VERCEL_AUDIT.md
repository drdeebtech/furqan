# Vercel Audit — furqan

**Date:** 2026-04-27
**Scope:** Vercel config (vercel.json, next.config.ts), live deployment health (last 20 deploys), env vars & secrets, performance & limits on Hobby plan
**Project:** `prj_Ofr1s9LGBgKGVrZeGtYgwsBigMgO` · `furqan` · `furqan.today`
**Auditor:** Claude Opus 4.7 (1M context) — read-only via Vercel MCP + repo grep

---

## Executive Summary

| Area | Grade | One-line rationale |
|---|---|---|
| **Build & Deploy** | A | Last 20 deploys all READY. Turbopack on every build. Lean function count (4 lambdas/deploy). |
| **Config Hygiene** | C+ | Three orphan cron routes. Node version drift between `.nvmrc`, `CLAUDE.md`, and the live project setting. |
| **Observability** | C | Sentry wired correctly but `tracesSampleRate: 1` will burn the free quota; PII + Replay enabled with no masking. |
| **Performance** | B | ISR landed on the slow public paths (k6-validated). Middleware still hits Postgres on every request. |
| **Security** | B | Headers + CSP solid. CSP keeps `'unsafe-eval'` (legacy). Hardcoded server-side DSN. |
| **Cost (Hobby)** | B− | Active CPU model is friendly to current load, but unbounded n8n proxy timeouts and per-request DB lookup are footguns under traffic. |

**Top three fixes (ship this week):**
1. Resolve the Node version drift (P0 #1)
2. Wire the three orphan crons into `vercel.json` (P0 #2)
3. Drop Sentry `tracesSampleRate` to 0.1 in production (P0 #3)

---

## Health Snapshot (positives)

- **Deploy reliability:** 20/20 most-recent deploys READY · production target · drdeebtech as author · zero ERROR/CANCELED
- **Bundler:** Turbopack on every recent deploy (`bundler: "turbopack"` in deployment meta)
- **Function count:** `lambdaRuntimeStats: {nodejs: 4}` per deploy — only 4 distinct functions, no fragmentation
- **Framework:** Next.js 16.2.4 + React 19.2.4 + `@sentry/nextjs@10.50.0` — fully current
- **Bundle hint:** `optimizePackageImports: ["lucide-react"]` in `next.config.ts:9`
- **Image hardening:** `images.remotePatterns` locked to a single Supabase host — no SSRF surface
- **Headers:** HSTS preload (2y), X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy correctly scoped to Daily.co (camera/mic) and Stripe (payment)
- **ISR rollout:** `/teachers-page` (300s), `/packages` (300s), `/blog` (600s) — commit `31c1e78`, k6 confirms ~50ms vs prior ~600–900ms
- **Domains:** apex `furqan.today` + `www.furqan.today` + 3 vercel.app aliases
- **Sentry layout:** canonical Next 13+ form — `src/instrumentation.ts` (server/edge bootstrap) + `src/instrumentation-client.ts` (browser + BotID + onRouterTransitionStart) + `sentry.server.config.ts` + `sentry.edge.config.ts`. `sentry.client.config.ts` correctly absent (would be dead code).

---

## P0 — Bugs / outages waiting to happen

### P0-1 · Node version drift between repo and Vercel project

**Symptom:** Three sources disagree on the Node version.

| Source | Value |
|---|---|
| `.nvmrc:1` | `20` |
| `CLAUDE.md` "Deployment Rules" | `20.x` (warns "do NOT use 24.x") |
| Live Vercel project (`get_project`) | `nodeVersion: "24.x"` |

**Root cause:** The CLAUDE.md rationale ("Vercel Hobby blocks deployments from unrecognized git authors on 24") is **outdated** — per the current Vercel knowledge baseline, **Node 24 LTS is the platform default** and Hobby supports it. Builds succeed because `.nvmrc` wins on the build runner, but the project setting and CLAUDE.md tell different stories, and any contributor who removes `.nvmrc` will silently switch runtimes.

**Fix (effort: 15 min):**
- Decide canonical version (recommend Node 24, the platform default)
- Update `.nvmrc`, the `engines.node` field in `package.json` (currently `20.x`), and the CLAUDE.md "Deployment Rules" section together
- Trigger one redeploy and confirm `runtimeStats` matches

### P0-2 · Three cron routes never fire

**Symptom:** Cron handlers exist on disk but no schedule entry triggers them.

| Route file | In `vercel.json` crons[]? |
|---|---|
| `src/app/api/cron/audit-cleanup/route.ts` | ✅ `0 2 * * *` |
| `src/app/api/cron/reconciliation/route.ts` | ✅ `0 3 * * *` |
| `src/app/api/cron/email-health/route.ts` | ✅ `0 6 * * *` |
| `src/app/api/cron/cache-clear/route.ts` | ❌ orphan |
| `src/app/api/cron/n8n-healthcheck/route.ts` | ❌ orphan |
| `src/app/api/cron/retention-score/route.ts` | ❌ orphan |

**Root cause:** Routes were added without the corresponding `vercel.json` entry. `n8n-healthcheck` is the worst offender — its purpose is to alert when n8n.drdeeb.tech goes down, but it has been silent.

**Fix (effort: 5 min):** Add three entries to `vercel.json` `crons[]`. Suggested schedules:
```json
{ "path": "/api/cron/n8n-healthcheck",  "schedule": "*/15 * * * *" },
{ "path": "/api/cron/retention-score",  "schedule": "0 4 * * *" },
{ "path": "/api/cron/cache-clear",      "schedule": "0 5 * * *" }
```
If any route is intentionally manual-only, delete the handler instead.

### P0-3 · Sentry `tracesSampleRate: 1` in production

**Symptom:** `sentry.server.config.ts` and `sentry.edge.config.ts` both ship 100% trace sampling. The client (`src/instrumentation-client.ts`) likely matches.

**Why it matters:** Free Sentry tier = 10k transactions/month. A public site with the k6 RPS already running would exhaust that in under a day. Once exhausted, you stop receiving the error context that motivated activating Sentry in the first place.

**Fix (effort: 10 min):** Conditional sampling:
```ts
tracesSampleRate: process.env.VERCEL_ENV === "production" ? 0.1 : 1,
```
Apply identically in server, edge, and client configs. Verify in Sentry dashboard → Stats that ingest drops within 24h.

`★ Insight ─────────────────────────────────────`
- Sentry counts a "trace" per Vercel function invocation when sampled. With Server Components, every page render is a function invocation — sampling rate compounds quickly.
- The 100% rate came from running the Sentry wizard, which optimizes for "you'll definitely see your first error." After the wizard, the right move is always to dial back.
`─────────────────────────────────────────────────`

---

## P1 — Security / privacy / hygiene

### P1-4 · `sendDefaultPii: true` + 100% error-Replay + GDPR exposure

**Symptom:** Server, edge, and client Sentry configs all set `sendDefaultPii: true`. Client also has `replaysOnErrorSampleRate: 1` (records ~30s of full DOM around any error).

**Why it matters:** Furqan teaches Quran to students of any age, including minors. PII flowing to Sentry includes user IPs, headers, request bodies, and (with Replay) form inputs and screen content. GDPR/COPPA + Saudi/Egyptian data-protection laws apply.

**Fix (effort: 30 min):**
- Add Replay privacy: `Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })` in `instrumentation-client.ts`
- Reconsider `sendDefaultPii: true`. If you keep it, document the privacy basis in the public privacy policy.
- Consider routing Sentry through Sentry's EU region (DSN already uses `ingest.de.sentry.io` ✅ — good)

### P1-5 · Hardcoded Sentry DSN in server/edge configs

**Symptom:** `sentry.server.config.ts` and `sentry.edge.config.ts` have the DSN as a string literal instead of `process.env.SENTRY_DSN`.

**Why it matters:** Defensible for the client bundle (DSN ships publicly anyway). Not defensible server-side: rotating DSN = code change + redeploy, instead of an env-var update + redeploy.

**Fix (effort: 5 min):** `dsn: process.env.SENTRY_DSN ?? "<current-hardcoded>"`. Falls back to current behavior if env unset.

### P1-6 · 10 env vars used in code but undocumented in CLAUDE.md

The env-var table in `CLAUDE.md` lists 16 variables. Code actually reads 26+. The undocumented ones:

| Variable | Purpose (inferred from code) |
|---|---|
| `CALLMEBOT_KEY_EG` / `CALLMEBOT_KEY_KW` | CallMeBot API keys (Egypt/Kuwait WhatsApp routing) |
| `CALLMEBOT_PHONE_EG` / `CALLMEBOT_PHONE_KW` | Recipient phone numbers |
| `CRON_SECRET` | Bearer token to gate `/api/cron/*` against random hits |
| `N8N_HEALTHCHECK_URL` | Endpoint hit by `/api/cron/n8n-healthcheck` (orphan, see P0-2) |
| `NEXT_PUBLIC_N8N_UI_URL` | Link to n8n UI from `/admin/n8n` |
| `RESEND_FROM_EMAIL` | Transactional email "From" header |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry ingest endpoints (server / client) |

**Why it matters:** Future contributors and AI assistants will follow CLAUDE.md as gospel. Missing entries → silent prod failures (the `RESEND_API_KEY` rotation in commit `2bc8173` is exactly this class of bug).

**Fix (effort: 10 min):**
- Add all 10 to the env-var table in `CLAUDE.md`
- Run `npx vercel env ls` and confirm each is set in Production + Preview + Development scopes
- Add a section to CLAUDE.md noting that the table is the source of truth

### P1-7 · CSP keeps `script-src 'unsafe-eval'`

**Symptom:** `vercel.json` CSP allows `'unsafe-eval'` globally.

**Why it matters:** Was needed historically by some Next bundler outputs. With Turbopack on Next 16.2 and no client-side eval-using dep visible in the deployment, the rule is likely vestigial. Keeping it weakens XSS protection.

**Fix (effort: 30 min):**
- Remove `'unsafe-eval'` from CSP, deploy to a preview branch
- Visit every page category (auth, public, student, teacher, admin) — watch console for CSP violations
- If something breaks, scope the allowance to just that path via Routing Middleware instead of globally

---

## P2 — Performance / cost on Hobby

### P2-8 · Middleware fetches a Postgres row on every request

**Symptom:** `src/proxy.ts` calls Supabase to refresh the session and then queries `profiles` for the role on every request matching the matcher (everything except `_next/static`, `_next/image`, `favicon.ico`, `sitemap.xml`, `robots.txt`, `/api/*`).

**Why it matters:** Vercel pricing is now **Active CPU + invocations** (not wall-clock GB-s). Middleware runs as a function invocation per request. A page that loads 5 client-rendered chunks doesn't multiply, but a typical session today (~30 page nav + ~50 background fetches) is ~80 middleware invocations. Each does ≥1 Supabase round-trip.

**Fix (effort: 1–2 hours):**
- **Option A (preferred):** Mint role into the JWT custom claim via a Supabase trigger; middleware reads it from the token, no DB hit.
- **Option B:** Cache role lookup in the Vercel **Runtime Cache API** (per-region KV, tag-invalidated). Key: `role:${userId}`, TTL 60s, invalidate on role update.
- **Option C (fallback):** Skip the role lookup for already-public paths (landing, blog, packages) by extending the matcher.

### P2-9 · No explicit `maxDuration` on n8n proxy routes

**Symptom:** `/api/n8n/executions/route.ts` and `/api/n8n/workflows/route.ts` (and several `/api/n8n/*` siblings) call out to n8n.drdeeb.tech without `export const maxDuration` and without an `AbortSignal` on the upstream fetch.

**Why it matters:** If the Mac mini stalls or its ISP blips, the function hangs to the platform default (300s), eating Active CPU and tying up an instance.

**Fix (effort: 20 min, all routes):**
```ts
export const maxDuration = 30;

const upstream = await fetch(N8N_URL, {
  signal: AbortSignal.timeout(25_000),
  // ...
});
```

### P2-10 · Stripe routes wired but feature is deferred

**Symptom:** `/api/stripe/checkout/route.ts` and `/api/stripe/webhook/route.ts` exist with `maxDuration = 60`, listed in CSP, but Stripe is documented as "deferred until API keys provided" (CLAUDE.md).

**Why it matters:** An attacker hitting `/api/stripe/webhook` with crafted payloads still spawns a function and runs verification logic before failing. Cheap but non-zero cost; also a weird-state surface area.

**Fix (effort: 5 min):** Add a feature-flag short-circuit at the top of each route:
```ts
if (!process.env.STRIPE_SECRET_KEY) {
  return new Response("Stripe not configured", { status: 503 });
}
```

---

## P3 — Modernization opportunities

### P3-11 · Migrate `vercel.json` → `vercel.ts`

`@vercel/config` is now the recommended path. Benefits: typed config, dynamic logic (e.g., env-aware CSP), DRY headers (the current CSP block is ~700 chars on one line and edits are fragile). Effort: ~1 hour. No urgency.

### P3-12 · Routing Middleware split

`src/proxy.ts` mixes Supabase session refresh with role-based redirects. Routing Middleware now supports Node.js runtime (no edge-only API limits). Splitting per concern would also let you cache/bypass the role check independently.

### P3-13 · Sentry Replay session sampling not env-gated

`replaysSessionSampleRate: 0.05` runs in dev/preview too. Cheap to fix:
```ts
replaysSessionSampleRate: process.env.VERCEL_ENV === "production" ? 0.05 : 0,
```

### P3-14 · k6 smoke as a deploy gate

The k6 script (`scripts/k6/...`) currently runs on demand. Wire it into a GitHub Action that runs against the latest preview URL post-merge; fail the workflow if p95 regresses. ~30 min.

---

## Verification (how to confirm each fix landed)

| Fix | How to verify |
|---|---|
| P0-1 Node version | `npx vercel inspect <prod-url>` → `runtime` field; CLAUDE.md / `.nvmrc` / `package.json engines` all match |
| P0-2 Crons wired | `curl -H "Authorization: Bearer $CRON_SECRET" https://furqan.today/api/cron/n8n-healthcheck` returns 200; Vercel dashboard → Cron Jobs lists 6 entries |
| P0-3 Sentry sampling | Sentry → Stats & Quotas → Transactions: 24h after deploy, ingest rate drops ~10× |
| P1-4 Replay masking | Trigger a known error in prod, open the replay, confirm form fields show as `***` |
| P1-5 DSN env-driven | `grep -n "ingest.de.sentry.io" sentry.*.config.ts` returns only fallback strings |
| P1-6 Env coverage | `npx vercel env ls --environment=production` includes all 26 vars |
| P1-7 CSP without `unsafe-eval` | Chrome DevTools → Console after visiting all role dashboards: zero CSP violations |
| P2-8 Middleware caching | Vercel function logs: invocation count drops, p50 middleware duration drops below 50ms |
| P2-9 n8n timeouts | `curl https://furqan.today/api/n8n/executions` returns within 30s even if n8n is throttled |
| P2-10 Stripe gate | `curl -X POST https://furqan.today/api/stripe/webhook` returns 503 (until keys are added) |
| P3-* | Visual confirmation via deploy preview |

---

## Out of scope for this audit

- **Code quality of route handlers** — covered by `AUDIT.md`
- **Frontend rendering / a11y / theming** — covered by `FRONTEND_AUDIT.md`
- **n8n workflow correctness** — covered by `N8N_AUDIT.md`
- **Supabase RLS / migrations** — covered by `SCHEMA.md` + the Branching integration
- **Stripe end-to-end** — pending API keys

---

**Next step:** Pick a sprint cadence — P0 fixes are <1 hour combined; P1 batch is ~1.5 hours; P2 batch is ~3 hours. Recommended ordering: P0-2 → P0-3 → P0-1 → P1-6 → P1-5 → P1-4 → P1-7 → P2-9 → P2-10 → P2-8.
