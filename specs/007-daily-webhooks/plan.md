# Implementation Plan: Daily.co webhooks as session-lifecycle source of truth

**Branch**: `007-daily-webhooks` | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-daily-webhooks/spec.md`

## Summary

Replace the page-visit-based `sessions.started_at`/`ended_at` write path with a Daily.co webhook receiver as canonical source of truth. Adds one route handler (`src/app/api/webhooks/daily/route.ts`), one new table (`daily_webhook_events` for idempotency), one additive column (`sessions.room_name`), and a small reconciliation update to the manual `endSession` action. Reuses the existing `emitEvent("session.ended", ...)` pattern for all downstream side effects so the hot path stays under 500ms P99 at 200-event burst load.

## Technical Context

**Language/Version**: TypeScript 5.x on Next.js 16.2.2 App Router (Node 24)
**Primary Dependencies**: `@supabase/ssr` (server client), `@supabase/supabase-js` (admin client), existing `src/lib/automation/emit.ts`, existing `src/lib/notifications/dispatcher.ts`, existing `loudAction` from `src/lib/actions/loud.ts`
**Storage**: PostgreSQL 17 (Supabase project `xyqscjnqfeusgrhmwjts`) — new table `daily_webhook_events`, new column `sessions.room_name`
**Testing**: Playwright (E2E for manual `endSession` reconciliation), unit tests for HMAC verifier + room→session mapper
**Target Platform**: Vercel Node runtime (Pro plan, 60s timeout headroom; not Edge — needs Node crypto for HMAC)
**Project Type**: web-service (existing Next.js webhook route alongside the n8n callback at `src/app/api/webhooks/n8n/route.ts`)
**Performance Goals**: 500ms P99 acknowledgement latency at 200-event burst in 60s; receiver itself does at most 3 DB queries (idempotency check, sessions update, bookings update via SQL function)
**Constraints**: Hot path forbidden from synchronous notify dispatches or n8n calls — all downstream work via post-commit `emitEvent`; HMAC verify before any body read; receiver supports `DAILY_WEBHOOK_SECRET` + optional `DAILY_WEBHOOK_SECRET_PREVIOUS` for 24-hour rotation overlap
**Scale/Scope**: 50,000 users → ~500 concurrent session-end events in peak 5-min window; nightly cleanup of `daily_webhook_events` via `audit-cleanup` cron (worst case 50k × ~5 sessions/week → ~250k webhook rows/week, cleaned at 7-day boundary)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| **I. Domain Ownership** | ✅ PASS | Owner-domain: **Session** (existing). Webhook is a new write path inside an existing domain, not a new domain. Cross-domain effects (parent notify, package deduction) ride existing `session.ended` event through `emitEvent` → `WEBHOOK_ROUTES`. New action is `endSessionFromWebhook` co-located alongside the manual `endSession` action; if it grows beyond a route adapter it migrates into `src/lib/domains/session/`. No constitutional event. |
| **II. Loud Failures** | ✅ PASS | Webhook receiver wraps its handler in a webhook-shaped equivalent of `loudAction` (since route handlers don't use `useActionState`, the equivalent is: log every accepted/rejected event to `audit_log`, route every error through `logError` with severity, surface failed-verification + unmappable-room counts to operator via Sentry warning rate). No discarded errors; no `?? []` swallow patterns. |
| **III. Atomic Critical Paths** | ✅ PASS | Critical path on `meeting.ended`: sessions UPDATE + bookings UPDATE. Wraps in a new Postgres SQL function `end_session_from_webhook(p_session_id uuid, p_ended_at timestamptz, p_duration_min int, p_event_id text)` modeled on existing `confirm_booking_with_session` and `deduct_package_session`. Side effects (notify, emit) run **post-commit** via `emitEvent("session.ended", ...)`. |
| **IV. Auth at the Boundary** | ✅ PASS — boundary is HMAC, not session auth | Route adapter verifies the Daily-signed HMAC before any DB read. No `requireRole` because there's no user session; the boundary primitive is signature verification. Domain function (`end_session_from_webhook`) receives already-verified input. |
| **V. Tracer-Bullet Adoption** | ✅ PASS | Single-pilot: one domain (Session), one event source (Daily.co), one new SQL function. No generalization to "webhook framework" — if a future provider (Stripe, Resend) needs the same shape, that's a separate spec. |
| **Bilingual UX** | ✅ N/A | Webhook receiver has no user-facing surface. Audit log action codes are English identifiers (`session.webhook.ended`) — consistent with existing `session.no_show`, `booking.confirmed`. |
| **DB migration discipline** | ✅ PASS | Two migrations: `<ts>_add_sessions_room_name_column.sql` (additive column + backfill from `room_url`) and `<ts>_add_daily_webhook_events_table.sql`. Both via `./scripts/new-migration.sh`, both apply via `.github/workflows/supabase-migrate.yml`. |
| **Secrets / env vars** | ✅ PASS | New env vars: `DAILY_WEBHOOK_SECRET` (required), `DAILY_WEBHOOK_SECRET_PREVIOUS` (optional, for 24hr rotation overlap). Both added to CLAUDE.md env-var table in the same PR (mandatory per constitution). |
| **50,000-user scale** | ✅ PASS — explicit at FR-006/-009 + SC-003 | Hot path bounded to 3 DB ops; idempotency lookup via primary key (O(log n)); room→session lookup via indexed `room_name` column, NOT substring on `room_url` (which would be 250k scans/day at 50k DAU). Burst tolerance of 500 events/60s explicit in FR-009. Cleanup cron sized for ~250k weekly webhook rows at 7-day retention. |
| **Branch hygiene** | ✅ PASS | Single branch `007-daily-webhooks`, single PR (#293) on the spec, follow-up PR for implementation when tasks.md lands. No v2 fork pattern. |

**Verdict**: All gates pass on first evaluation. No complexity-tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/007-daily-webhooks/
├── plan.md              # This file
├── spec.md              # Already authored
├── research.md          # Phase 0 output (below)
├── data-model.md        # Phase 1 output (below)
├── quickstart.md        # Phase 1 output (below)
├── contracts/           # Phase 1 output (webhook payload schema)
│   └── daily-webhook-payload.md
├── checklists/
│   └── requirements.md  # Already authored
└── tasks.md             # Phase 2 output — NOT created by /speckit.plan
```

### Source Code (repository root)

```text
src/
├── app/
│   └── api/
│       └── webhooks/
│           ├── daily/                    # NEW
│           │   └── route.ts              # POST handler + HMAC verify + dispatch
│           └── n8n/                      # existing — reference shape
│               └── route.ts
├── lib/
│   ├── daily/
│   │   ├── webhook-verify.ts             # NEW — HMAC verifier (constant-time)
│   │   └── webhook-handler.ts            # NEW — payload → SQL function dispatch
│   ├── automation/
│   │   └── emit.ts                       # existing — emitEvent("session.ended")
│   └── logger.ts                         # existing — logError + Telegram severity
└── app/teacher/dashboard/
    └── actions.ts                        # existing — endSession; needs idempotency tweak

supabase/migrations/
├── <ts>_add_sessions_room_name_column.sql       # NEW
└── <ts>_add_daily_webhook_events_table.sql      # NEW (includes end_session_from_webhook function)

tests/  (or co-located *.test.ts under each module — match existing repo convention)
├── lib/daily/
│   ├── webhook-verify.test.ts            # NEW unit
│   └── webhook-handler.test.ts           # NEW unit
└── e2e/
    └── daily-webhook-reconciliation.spec.ts  # NEW E2E
```

**Structure Decision**: Web-service variant of the single-project layout. Webhook routes already live under `src/app/api/webhooks/<provider>/route.ts` (n8n is the existing example). New `src/lib/daily/` directory mirrors `src/lib/n8n/` and `src/lib/automation/`. No frontend changes.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| *(none)* | All Constitution gates pass on first evaluation. | — |

---

## Phase 0 — Research

See [research.md](./research.md) for the resolved unknowns. Summary:

1. **Daily.co webhook payload shape**: confirmed `meeting.started` / `meeting.ended` events carry `id`, `type`, `room` (with `name`), `start_time`, `end_time` (epoch seconds), `duration` (seconds). HMAC signature in `X-Webhook-Signature` header, computed as `HMAC-SHA256(secret, body).hex()`.
2. **HMAC verification pattern**: Node crypto's `timingSafeEqual` for constant-time comparison. Decode signature header from hex, compute server-side HMAC over the **raw** body (not the parsed JSON — preserves whitespace + key order).
3. **Idempotency strategy**: `UNIQUE(event_id)` constraint on `daily_webhook_events` + `INSERT ... ON CONFLICT DO NOTHING` — single round-trip, atomic, no race window.
4. **Room name field**: Daily's `room.name` is the unique identifier we create via `createRoom`. The existing `createRoom` in `src/lib/daily.ts` returns the room URL; we now also capture `room.name` from the response and persist it.
5. **Burst handling**: Vercel Node runtime concurrency is per-function; under burst, requests queue at the platform level. With each handler ≤ 50ms compute + 3 DB ops, we can serve 500 events/min sequentially on one cold function — no special queueing needed.

## Phase 1 — Design

See:
- [data-model.md](./data-model.md) — new + changed tables, new SQL function signature
- [contracts/daily-webhook-payload.md](./contracts/daily-webhook-payload.md) — verified Daily.co payload schema + headers
- [quickstart.md](./quickstart.md) — operator-facing setup + verification steps

## Post-design Constitution Re-check

All gates still pass after the data-model + contracts design:

- **III. Atomic Critical Paths**: confirmed by `end_session_from_webhook` SQL function design (atomic sessions + bookings + audit_log writes).
- **50k-user scale**: confirmed by indexed-PK lookup pattern in idempotency and room→session map; no JOINs added to hot path.
- All other gates unchanged.
