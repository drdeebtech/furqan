# FURQAN Pre-Launch Audit — GO/NO-GO Report

**Date:** 2026-05-15  
**Auditor:** Claude Code  
**Branch:** `main` @ `bb273c2`  
**Phases completed:** P0–P12  

---

## Verdict: NO-GO (conditional)

The platform is architecturally sound and the core infrastructure is production-grade. However, **4 confirmed bugs** in the financial/data-integrity domain must be resolved before launch. Payments are also a stub requiring a binary decision.

Once the 4 critical items below are closed, the verdict flips to **GO WITH CONDITIONS** (2 warnings still outstanding).

---

## Critical Blockers (must fix before launch)

| # | Issue | Phase | Finding |
|---|-------|-------|---------|
| 1 | `SECURITY DEFINER` missing from `deduct_package_session` | P3/P12 | Issue #246 — package deduction RPC may not run with correct privileges; financial correctness is broken |
| 2 | `startInstantSession` bypasses package-balance check | P12 | Issue #229 — students can start sessions without a valid package (FR-009 violation); direct revenue loss |
| 3 | `deduct_package_session` return value ignored by TS callers | P12 | Issue #247 — silent session expiry/exhaustion with no error surfaced |
| 4 | **Stripe integration is a stub** | P11 | No checkout, no webhook sig verification, no env vars — payment flow is non-functional. **Blocker only if launch requires payments.** If billing is manual at launch, downgrade to Warning. |

---

## Warnings (fix soon, not hard launch-blockers)

| # | Issue | Phase | Finding |
|---|-------|-------|---------|
| W1 | Homework grade + auto-regen not atomic | P3/P12 | Issue #245 — race window between grade write and auto-regen trigger; data inconsistency possible under concurrent writes |
| W2 | CALLMEBOT_KEY_KW absent | P0/P6 | Kuwait operator receives zero WhatsApp alerts — operational blind spot |
| W3 | 3 API routes use local `timingSafeEqual` instead of `safeCompareSecret` | P2 | `retention/score`, `reports/session/[id]`, `reports/session/[id]/send` — not a security gap today, but diverges from canonical implementation |
| W4 | 13 action files lack `loudAction` wrapping | P4 | Courses, community, quizzes, resources domain — failures are invisible in logs |
| W5 | ESLint scans `.claude/helpers/` — 30 false-positive errors | P1 | Masks the 3 real src errors; add `.claude/**` to ESLint ignores |
| W6 | `SortIcon` component defined inside render | P1 | `src/app/teacher/progress/roster-heatmap.tsx:97` — creates new component type on every render; subtle state bug |
| W7 | `setState` synchronously inside `useEffect` | P1 | `src/components/admin/remote-handoff-button.tsx:55` — cascading renders |
| W8 | `@vitest/coverage-v8` not installed | P7 | CI has no coverage % gate; 80% threshold unenforced |
| W9 | `db-types-fresh` CI stale (8 days) | P0 | TypeScript types may drift from deployed schema |
| W10 | No UNIQUE constraint on `bookings(teacher_id, scheduled_at)` | P3/P12 | Issue #244 — slot race window exists at DB level |
| W11 | 1 unbounded `select("*")` in `n8n/admin-actions` | P5 | Low-traffic admin endpoint but needs `.limit()` |
| W12 | `supabase-lint` CI last had failure (9 days ago, not re-run) | P0 | Unknown if current migrations pass lint |

---

## Passing ✅

| Area | Evidence |
|------|---------|
| Build (`next build`) | Exit 0 — 134 routes, TypeScript clean, 11.5s |
| TypeScript (`tsc --noEmit`) | Exit 0 — zero type errors |
| Unit tests | 225/249 pass; 19 test files covering critical paths |
| Sentry | 0 unresolved issues (7-day window) |
| Cron auth | All 10 routes dual-auth gated (`CRON_SECRET` + `N8N_WEBHOOK_SECRET`) |
| n8n scheduling | No Vercel cron jobs — n8n owns scheduling correctly |
| Moderator retirement | Zero `is_moderator()` / `is_admin_or_mod()` calls in application code |
| `/moderator` redirects | Present in `proxy.ts` |
| RTL / bilingual | `lang` + `dir` set dynamically; Arabic-first ✅ |
| SECURITY DEFINER usage | All intentional, documented, and search_path-locked |
| Empty catch blocks | Zero |
| console.log in API routes | Zero |
| Node version alignment | v24.15.0 = .nvmrc = engines = Vercel ✅ |
| WhatsApp graceful degradation | Code handles absent key without crash |
| n8n client error handling | Throws on missing config, logError on failures |
| Stripe stub isolation | Non-functional payment routes don't break other flows |
| E2E tests | 10 spec files covering auth, admin, session lifecycle |

---

## Pre-Launch Checklist

```
□ Fix issue #246 — add SECURITY DEFINER to deduct_package_session migration
□ Fix issue #229 — enforce package balance in startInstantSession
□ Fix issue #247 — surface deduct_package_session return value to callers
□ DECISION: Ship without payments (stub stays) or complete Sprint 1 (Stripe keys)

□ Fix issue #245 — make grade + auto-regen atomic (or formally accept risk)
□ Add CALLMEBOT_KEY_KW to Vercel production
□ Add .claude/** to .eslintignore
□ Move SortIcon outside render function (roster-heatmap.tsx:97)
□ Install @vitest/coverage-v8 + add CI coverage gate
□ Re-run db-types-fresh workflow against correct Supabase account (#185)
□ Re-run supabase-lint to confirm current migrations are clean
```

---

## Report Files

| Phase | File | Key finding |
|-------|------|-------------|
| P0 | P0-baseline.md | Inventory snapshot |
| P1 | P1-repo-health.md | Build/TS clean; lint has false positives + 3 real errors |
| P2 | P2-security.md | Cron auth solid; 3 routes use local timingSafeEqual |
| P3 | P3-database.md | Issues #246 + #245 are confirmed bugs |
| P4 | P4-silent-failures.md | No empty catches; 13 action files unwrapped |
| P5 | P5-performance.md | 1 unbounded query in admin endpoint |
| P6 | P6-notifications.md | KW operator dark; all other integrations live |
| P7 | P7-test-coverage.md | 225 tests pass; no coverage % gate |
| P8 | P8-n8n-static.md | All cron routes auth-gated; no Vercel crons |
| P9 | P9-a11y-i18n.md | RTL/lang correct; full ARIA audit deferred |
| P10 | P10-auth.md | Moderator retirement clean |
| P11 | P11-deployment.md | Build pipeline solid; Stripe is stub |
| P12 | P12-outstanding.md | 4 critical bugs, Stripe decision pending |
