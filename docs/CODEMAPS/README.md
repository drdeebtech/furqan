# Furqan Codemaps

**Last Updated:** 2026-06-22

This directory contains architectural maps of the Furqan codebase, organized by layer. Use these maps to navigate code without re-exploring the repo from scratch.

## How to Navigate This Repo

Furqan is a full-stack Next.js (App Router) + Supabase + Stripe Quran-memorization platform. The codebase is organized into **layers**:

1. **App screens** (`src/app/{admin,teacher,student,(public),(auth)}/...`) — user-facing routes and layouts
2. **API routes** (`src/app/api/...`) — webhooks, cron jobs, external integrations
3. **Server actions & views** (`src/lib/actions/**`, `src/lib/views/**`) — request handlers, cross-route queries
4. **Domains** (`src/lib/domains/**`) — business logic owners (billing, booking, progress, etc.)
5. **Data layer** (`supabase/migrations/**`, `src/types/database.ts`) — schema, RLS, functions

**Golden Rule:** Every change touches **three lenses simultaneously** (full-stack engineer, Quran teacher, teaching-platform expert) — see `CLAUDE.md` for details.

## Codemaps

| File | Scope |
|------|-------|
| [domains.md](./domains.md) | `src/lib/domains/**` — 47 files, 15 domain owners (billing, booking, progress, etc.) |
| [actions-and-views.md](./actions-and-views.md) | `src/lib/actions/**` + `src/lib/views/**` — server actions, cross-route reads, barrel pattern |
| [api-routes.md](./api-routes.md) | `src/app/api/**` — 67 routes (webhooks, cron, integrations, auth) |
| [app-screens.md](./app-screens.md) | `src/app/{admin,teacher,student,(public),(auth)}/...` — user-facing pages & layouts |

## Quick Lookups

**Finding code by symptom:**

- **billing / checkout / subscription** → `domains.md` (Billing section) or `api-routes.md` (Stripe routes)
- **booking allowed? credits/paywall?** → `domains.md` (Booking section, `actions.ts`)
- **dashboard reads slow?** → `actions-and-views.md` (views section)
- **session end / confirm / no-show** → `domains.md` (Session/Booking sections)
- **why did a widget fail?** → `logError` tags every failure with `route` + `widget`; grep the tag in logs

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────┐
│  src/app/{admin,teacher,student,(public),(auth)}/          │
│  User-facing screens, layouts, page.tsx, layout.tsx        │
└──────────────────┬──────────────────────────────────────────┘
                   │ FormData, FormState, cookies
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  src/app/api/**, src/lib/actions/**                        │
│  Route adapters: auth checks, validation, orchestration    │
└──────────────────┬──────────────────────────────────────────┘
                   │ Structured input, userId from session
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  src/lib/domains/**                                        │
│  Domain owners: billing, booking, progress, session, etc.  │
│  (phase 5 pilot: Booking owns actions.ts + types.ts)       │
└──────────────────┬──────────────────────────────────────────┘
                   │ SQL via Supabase client
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  supabase/migrations/**, src/types/database.ts             │
│  Postgres (RLS, functions, indexes, triggers)              │
└─────────────────────────────────────────────────────────────┘
```

## Key Patterns

**"use server" barrel pattern:**
- Leaf files (`src/lib/actions/*.ts`) carry `"use server"` declarations
- Re-export barrels (`src/app/role/feature/actions.ts`) carry **no** `"use server"` — else Turbopack drops client references
- Always `npm run build` (not just `tsc`) to catch Turbopack failures

**Domain ownership:**
- Domains are defined in `CONTEXT.md` — read it for exact responsibility boundaries
- Domain actions (mutations) live in `src/lib/domains/<domain>/actions.ts` (Phase 5 pilot: Booking only)
- Cross-role actions still live in `src/lib/actions/` until migrated
- Orchestrators own cross-domain choreographies (`src/lib/domains/<domain>/orchestrate.ts`)

**Route adapters:**
- Validate input with Zod at the boundary
- Extract `userId` from session, never from input
- Call domain functions with structured input
- Wrapped in `loudAction({ handler, audit, schema, ... })` for unified error handling & logging

## Verify Before Done

1. `npx tsc --noEmit` — typecheck must pass
2. `npm run lint` — eslint must pass
3. `npm run build` — Turbopack must pass (catches server/client boundary violations)
4. `npm test` — Playwright E2E on critical flows

See `CLAUDE.md` for full toolchain and testing requirements.
