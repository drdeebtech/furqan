# Admin Surface Audit — 2026-04-25

Audit of the entire `/admin/*` surface (46 routes) across four lenses: **code quality & data correctness, performance, accessibility & UX, security & auth**. This document extends — does not replace — the prior platform-wide `AUDIT.md`.

## Methodology

Four parallel exploration agents, one per lens, each fed the route inventory and lens-specific grep patterns. Findings cross-checked against the actual codebase. Two false-positive headline P0s from the security agent (claims that `audit_log` and `blog_posts` tables don't exist) were verified and downgraded — those tables are V8 base tables, documented in `SCHEMA_FINAL.md` Tables 19 and applied to Supabase directly; the local `src/lib/supabase/migrations/` folder only holds V9+ deltas.

## Severity rubric

- **P0** — security hole, data corruption risk, broken-on-prod path. Fix this pass.
- **P1** — silent failure, missing auth on mutation, accessibility blocker (WCAG A). Fix this pass.
- **P2** — perf wins >100ms, UX friction, missing loading/empty states, lint/type debt. Fix this pass.
- **P3** — cosmetic, naming, dead code. Defer to `ROADMAP.md` "Admin polish" section.

## Findings — combined table

| # | Sev | Lens | File:Line | Finding | Suggested fix |
|---|-----|------|-----------|---------|---------------|
| 1 | P1 | Security | `src/app/admin/dashboard/page.tsx:24` | No page-level role re-check. Only `if (!user) redirect("/login")`. Middleware is the single defense. | Add `getProfile()` and `if (profile.role !== "admin") redirect(...)` like `control-tower/page.tsx:16`. |
| 2 | P1 | Security | 30 of 46 admin pages | Most pages skip the page-level role re-check that `control-tower/page.tsx` does. | Pick one pattern; recommend adding it inside `src/app/admin/layout.tsx` so every page gets it for free. |
| 3 | P1 | Code quality | `src/app/admin/notifications/actions.ts:30` | Direct `.from("notifications").insert(...)` bypasses `notify()` / `dispatchNotification()` (CLAUDE.md rule). | Route through `notify()` from `src/lib/notifications/dispatcher.ts`. |
| 4 | P1 | Code quality | `src/app/admin/announcements/actions.ts:14` | Local `requireAdmin()` shadow defined; `src/lib/auth/require-admin.ts:11` already exports the same. | Delete local helper, import the shared one (already used by `teachers/[id]/actions.ts`). |
| 5 | P1 | Code quality | `src/app/admin/bookings/actions.ts:13` | `adminUpdateBookingStatus` mutates booking status but never calls `emitEvent()` for `booking.confirmed` / `booking.cancelled`. | Add `emitEvent("booking.<status>", { bookingId, … })` before `revalidatePath`. |
| 6 | P1 | Performance | `src/app/admin/users/page.tsx:24-29` | N+1: profiles fetched, then retention_signals fetched separately for the student subset. | Run both in `Promise.all` using `.in("student_id", studentIds)`. |
| 7 | P1 | Performance | `src/app/admin/sessions/page.tsx:64-77` | N+1: sessions → bookings → profiles in three sequential rounds. | Single Promise.all with `.in("id", bookingIds)` and `.in("id", profileIds)` then merge. |
| 8 | P1 | Performance | `src/app/admin/teachers/page.tsx:23-33` | CV pending count fetched after teacher list — sequential. | Move into the existing Promise.all alongside teacher fetch. |
| 9 | P1 | A11y | `src/components/shared/data-table.tsx:42-48` | No `scope="col"` on `<th>`; no `aria-sort`, no `aria-busy`. Affects every admin table. | Add `scope="col"` always; `aria-sort` when column is sortable; `aria-busy` on `<tbody>` when loading. |
| 10 | P1 | A11y | `src/components/shared/data-table.tsx:121-123` | Action "button" is `<span role="button" tabIndex=0>`. Loses native button semantics. | Replace with real `<button>` and `aria-label`. |
| 11 | P1 | A11y | `src/app/admin/blog/post-form.tsx:36-40`, `announcements/announcement-form.tsx:39` | Error messages render in a plain `<div>` — screen readers don't announce. | Wrap in `<div role="alert" aria-live="polite">`. |
| 12 | P1 | A11y | `src/app/admin/blog/post-form.tsx:44, 50` | `<label>` without `htmlFor` — not bound to input. | Add `htmlFor` matching input `id`. |
| 13 | P1 | A11y | `src/app/admin/blog/post-form.tsx:66, 98, 108` + many more | `text-left` hardcoded — breaks RTL. | Replace with logical property `text-start`. Bulk replace across admin forms. |
| 14 | P2 | Performance | `src/app/admin/dashboard/page.tsx:40-62` | 14 round-trips per dashboard load. Many are simple counts/aggregates. | Consolidate into 2–3 Postgres views or RPCs (`v_admin_dashboard_today`, `v_admin_dashboard_trends`). |
| 15 | P2 | Performance | `src/app/admin/control-tower/page.tsx:47-58` | At-risk packages fetched outside the Promise.all; low-balance filter applied client-side. | Add to Promise.all; filter via `.lt("remaining_sessions", 3)` server-side. |
| 16 | P2 | Performance | repo-wide admin pages | Only `dashboard/loading.tsx` exists. 10+ heavy routes show blank during fetch. | Add `loading.tsx` skeletons for `control-tower`, `users`, `teachers`, `sessions`, `bookings`, `retention`, `evaluations`, `automation`, `payments`, `audit`. |
| 17 | P2 | Performance | repo-wide admin pages | Zero `<Suspense>` boundaries — pages wait for the slowest query. | Wrap independent dashboard widgets in `<Suspense>` with skeleton fallback. |
| 18 | P2 | Performance | DB | Missing composite indexes on hot filter+sort columns. | New `supabase/migrations/v14_007_admin_perf.sql` adding: `bookings(status, booking_date)`, `sessions(status, start_time)`, `teacher_profiles(cv_status, created_at)`, `retention_signals(churn_risk_score DESC, student_id)`. |
| 19 | P2 | Code quality | `src/app/admin/sessions/actions.ts:73-76, 297-300` | Update + observer-insert errors not checked; silently proceeds. | Destructure `error` and short-circuit with `{ error }` return. |
| 20 | P2 | Code quality | `src/app/admin/sessions/actions.ts:310` | `joinAsObserver` mutates without `revalidatePath`. | Add `revalidatePath("/admin/sessions/live")`. |
| 21 | P2 | Code quality | 26 admin files | Inline `supabase.from("profiles").select("role")` role checks duplicated. | Replace with shared `requireAdmin()` (already in `src/lib/auth/require-admin.ts`). |
| 22 | P2 | Code quality | `src/app/admin/users/page.tsx`, `teachers/page.tsx`, `bookings/page.tsx`, `sessions/page.tsx` | Inline `nameMap` of profile-id → name repeated. | Extract `src/lib/admin/name-map.ts` with a single `buildNameMap(profileIds)` helper. |
| 23 | P2 | A11y | `src/app/admin/announcements/page.tsx`, `retention/page.tsx` | Returns `null` when no data → blank page. | Render an empty-state card with friendly bilingual message. |
| 24 | P2 | A11y | `src/app/admin/error.tsx:15`, `widget-card.tsx:22`, `stat-card.tsx:34` | `text-red-400` / muted-text on light surfaces likely <4.5:1 in dark mode. | Bump to `red-500/600`; verify with axe contrast checker. |
| 25 | P2 | A11y | `src/app/admin/teachers/page.tsx`, `teachers/[id]/page.tsx` | Status badges use color-only (red/green) — fails for color-blind users. | Add icon (✓ / ⏳ / ✗) and text alongside color. |
| 26 | P2 | A11y | `src/app/admin/blog/post-form.tsx:119-125` | Submit button uses `disabled={pending}` without `aria-busy`. | Add `aria-busy={pending}`. |
| 27 | P2 | A11y | repo-wide admin pages | Multiple instances of `ml-*`/`mr-*`/`pl-*`/`pr-*`/`right-*`/`left-*` hardcoded. | Logical-property sweep: `ms-*`/`me-*`/`ps-*`/`pe-*`/`start-*`/`end-*`. |
| 28 | P2 | Security | various server actions | `requireAdmin()` adoption inconsistent: `bookings/actions.ts`, `sessions/actions.ts`, `homework/grade/actions.ts`, `retention/actions.ts`, `users` actions, `packages` actions don't use it. | Audit each, add at top of every mutation. |
| 29 | P2 | Security | `src/app/admin/sessions/actions.ts:37-90` and similar | Some destructive actions (`forceEndSession`) write `audit_log`; `deleteUser`, force-cancel, package price change, settings toggle, automation replay don't. | Add `audit_log` insert wrapper or trigger. |
| 30 | P2 | Security | `src/app/api/n8n/admin-actions/route.ts` | Imports admin client. Role check / shared-secret enforcement unclear. | Verify; if missing, require `N8N_WEBHOOK_SECRET` (timing-safe like `webhooks/n8n/route.ts`). |
| 31 | P2 | Code quality | `src/app/admin/sessions/actions.ts` (9×), `teachers/[id]/actions.ts` (8×), others | Heavy `as never` casts on insert/update payloads. | Regenerate Supabase Database types and remove unnecessary casts. |
| 32 | P3 | A11y | several | Hardcoded English service names ("Supabase", "Daily.co", "Stripe") in `/admin/settings`. | Wrap in `t()` helper or constants file. |
| 33 | P3 | A11y | several | Icon-only buttons missing `aria-label`. | Audit and add. |
| 34 | P3 | A11y | several | Some forms lack focus trap on modals; route transitions don't move focus to `<h1>`. | Add `useFocusOnMount` hook for h1 focus. |
| 35 | P3 | Code quality | various | Stale TODO/FIXME and dead imports flagged by lens-1 agent. | Sweep with `next lint` and manual pass. |
| 36 | P3 | Performance | `src/app/admin/retention/page.tsx:112-126` | Filters applied in JS after fetch. | Push `applyFilters` into Supabase `.eq/.gte/.lt`. |

## Triage summary

| Severity | Count | Disposition |
|----------|------:|-------------|
| P0 | 0 | Originally 4 P0 from agent reports; 2 downgraded after verification (audit_log + blog_posts exist), 2 reclassified to P1 (auth coverage). |
| P1 | 13 | Fix this pass — all in waves 1–4. |
| P2 | 18 | Fix this pass — waves 5–7. |
| P3 | 5 | Defer to `ROADMAP.md`. |

## Wave plan (Phase 3 execution)

1. **Wave 1 — Shared components** → fixes #9, #10. Single edit to `data-table.tsx` ripples across every admin table.
2. **Wave 2 — Loading / error boundaries** → fixes #16, #23. Bulk-add `loading.tsx` skeletons; verify `error.tsx` covers nested routes.
3. **Wave 3 — Auth consistency** → fixes #1, #2, #28. Move role re-check into `src/app/admin/layout.tsx` so it covers all 46 pages, then eliminate per-page duplicates.
4. **Wave 4 — Server-action hardening** → fixes #3, #4, #5, #19, #20, #29. Replace local `requireAdmin`, route notifications through `notify()`, add `emitEvent()` calls, add `audit_log` inserts on destructive mutations, fix silent errors.
5. **Wave 5 — Query consolidation + indexes** → fixes #6, #7, #8, #14, #15, #18. New migration `v14_007_admin_perf.sql`; rewrite three N+1 patterns to Promise.all + `.in()`; add Suspense in dashboard.
6. **Wave 6 — A11y sweep** → fixes #11, #12, #13, #17, #24, #25, #26, #27. Mostly mechanical; one big PR.
7. **Wave 7 — Dead code & duplication** → fixes #21, #22, #31. Extract helpers; regenerate types.

## Verification (per wave + final)

- `npx next build` (zero new errors).
- `npm run lint` (no new errors over baseline).
- `npx playwright test e2e/admin-*.spec.ts` (3 specs must pass).
- Browser smoke via Claude-in-Chrome on `/admin/dashboard`, `/admin/control-tower`, `/admin/users`, `/admin/teachers`, `/admin/bookings`, `/admin/sessions`.
- Wave 5 specifically: confirm dashboard query count drops to ≤4 round-trips (was 14) by checking Supabase dashboard logs or pg_stat_statements.
- Wave 6 specifically: axe-core scan on `/admin/dashboard` and `/admin/users` — zero criticals.

## Out of scope

Stripe checkout, AI workflows in n8n, WhatsApp Business, Google Calendar — all blocked on external keys (per `CLAUDE.md`). Not addressed by this audit.

## Notes for future audits

- Migration files for V8 base tables live in Supabase directly, not in `src/lib/supabase/migrations/`. Use `SCHEMA_FINAL.md` as the source of truth for table existence — grepping migrations alone is insufficient.
- `src/lib/auth/require-admin.ts` is the canonical role-check helper. New code should import it; do not redefine.
- Three Playwright specs already cover admin tabs (`e2e/admin-cv-edit.spec.ts`, `e2e/admin-tabs-diagnostic.spec.ts`, `e2e/admin-tabs-visual-audit.spec.ts`) — extend these rather than starting a new test file.
