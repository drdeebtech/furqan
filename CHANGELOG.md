# Changelog

All notable changes to FURQAN Academy are documented here.

## 2026-06-12 — Test: Coverage improvements for promise-utils, logger, and require-admin

Raised test coverage for three critical infrastructure modules:

- **`src/lib/promise-utils.ts`** (33% → 100%) — added `withTimeout` tests covering: successful resolution, timeout fallback (fake timers), rejection fallback, and correct log message tags (`query timeout` vs `query error`); and `chunk` tests covering split, single-chunk, empty input, exact multiples, large input, and invalid-size throws.
- **`src/lib/logger.ts`** (55.9% → 94.7%) — added `logError` tests (Sentry capture, DSN-only capture, console fallback, Telegram critical-alert path), `logWarn` tests (structured logger path, `captureMessage` fallback, console fallback), and `logInfo` tests (breadcrumb always fires, structured logger path, console fallback in non-production, production suppression).
- **`src/lib/auth/require-admin.ts`** (65.4% → 100%) — added coverage for `getUser` throw (defensive catch), profile lookup throw (null role → `ForbiddenError`), `requireRole` multi-role array overload, and all four `requireAdminForApi` branches (200 admin, 401 unauthenticated, 403 forbidden, rethrow).

### For contributors

Pre-landing fixes: merged split import statements in `promise-utils.test.ts`, fixed TypeScript double-assertion patterns in `require-admin.test.ts`, replaced invalid `process.env.NODE_ENV` direct assignment with a type cast in `logger.test.ts`.

## 2026-06-05 — Fix: Stripe checkout UUID validation (issue #408)

`POST /api/stripe/checkout` now validates that `package_id` is a well-formed UUID before touching the database. Previously, a non-UUID string such as `"test-valid-package-id"` reached the Postgres `.eq("id", …)` call and caused a `22P02` unhandled exception, returning 500 instead of 400. Includes a `typeof` guard to block array-typed inputs that would otherwise coerce through the regex.

- **Route:** `src/app/api/stripe/checkout/route.ts` — 2-line UUID regex + typeof guard added after the `package_id` presence check.
- **Tests:** `src/app/api/stripe/checkout/route.test.ts` — 7 new unit tests covering 401, 403, 400 (missing/invalid/array), and 501 (valid UUID, Stripe SDK not installed).

## 2026-05-08 — Moderator role retired (ADR-0003)

The `moderator` role was removed from FURQAN's role taxonomy. Every moderator-owned feature already had an admin equivalent (`/admin/teachers/cv` mirrored `/moderator/cv-review`, `/admin/audit` mirrored `/moderator/audit`, etc.) — the role added vocabulary, route surface, ENUM value, RLS branches, and 14 auth-helper call sites without unique capability.

Earlier CHANGELOG entries that mention moderator (the 5-boundary error.tsx note, the moderator at-risk widget, the dual-auth API row, etc.) describe historical state at the time of those releases — accurate as a record of what shipped then. Current state diverges per this 2026-05-08 work.

### Database (PR #212/#213/#214 → migration `20260507223609_drop_moderator_role.sql`)

- **1 moderator user migrated to admin** (atomic single-statement UPDATE so the `profiles_active_role_in_set` CHECK constraint sees consistent state).
- **`private.is_moderator()` body replaced** to return `false`. `private.is_admin_or_mod()` body collapsed to admin-only. NOT dropped — 13+ dependent policies on sessions/student_packages/study_log/ijazah/mentorship/storage would have cascade-dropped.
- **`resource_assignments_admin_all` RLS policy** rewritten admin-only (the only policy that hardcoded the `'moderator'` literal).
- **CHECK constraints** added: `profiles_role_no_moderator` and `profiles_roles_no_moderator` make the `'moderator'` ENUM value unreachable. The value remains in `user_role` as a dead union member (pragmatic path; clean ENUM recreate was blocked by 20-policy column-type-ALTER cascade).

### Code (PR #212)

- Deleted `src/app/moderator/` (24 files; all routes 301-redirect to `/admin/*` equivalents via `RENAMED_ROUTES` in `src/proxy.ts`).
- Removed `requireModerator()` and `requireAdminOrModerator()` from `src/lib/auth/require-admin.ts`. Migrated 4 call sites to `requireAdmin`.
- Stripped `'moderator'` from ~28 role-check arrays, type unions, compound `&&`/`||` conditions, and `Record<Role, …>` literals.
- Deleted 3 moderator queries from `src/lib/dashboard-queries.ts` (`getModeratorWeeklyCVActivity`, `getModeratorRatingDistribution`, `getModeratorFlaggedEvaluations`).
- Updated `require-admin.test.ts` test inputs to use `'teacher'` instead of `'moderator'` for multi-role coverage.

### Docs

- New: `docs/adr/0003-drop-moderator-role.md`.
- Amended: `docs/adr/0001-require-role-wrap-pattern.md` (supersession note for the dropped wrappers).
- Updated: `CLAUDE.md`, `CONTEXT.md`, plus 11 reference docs across the repo (PROJECT, SCHEMA_FINAL, AUDIT, EVENT_CATALOG, ROADMAP, EXCEPTION_PLAYBOOKS, .impeccable, automation/BLUEPRINT, automation/VPS_HANDOFF, etc.) — current-state sections updated to 3 roles; historical/V9-era entries preserved as record.

### Pre-flight lessons (added to ADR-0003)

When dropping an ENUM value in Postgres, pre-flight queries must enumerate:
1. `pg_attribute` rows for every column using the type
2. `pg_policies` rows referencing the literal value
3. `pg_proc` rows referencing the literal value
4. `pg_constraint` rows (CHECK constraints) referencing the value — **caught the first PR-driven failure**
5. `pg_policies` rows referencing the *column generally* (not just the value) — these block `ALTER COLUMN TYPE`, **caught the second**

The original PR-driven attempts hit (4) and (5) sequentially; the pragmatic path (CHECK constraint + function-body-replace) sidesteps both.

---

## 2026-04-26 — No-silent-failures pass + DB hardening + teacher onboarding

A long autonomous session that closed the "silent failure" anti-pattern across the platform, hardened the Supabase project to A++ grade, and shipped a complete teacher self-application flow.

### Added — Teacher self-application (`/teach/apply`)

- Public bilingual form replacing the WhatsApp-only intake. 12 recitation schools + 18 specialties grouped by intent. Optional photo upload (JPG/PNG/WebP, max 2 MB) into a new `teacher-avatars` Supabase Storage bucket. Per-IP rate limit (3/hour) backed by `automation_logs`. Creates auth.users + profiles + teacher_profiles in one server action.
- **Magic-link email** to candidate via Resend (`noreply@furqan.today`, DKIM/SPF/DMARC verified) — they land directly in `/teacher/dashboard`.
- **Approval email** when admin approves — green template with deep-link to their card on the public listing (`#teacher-<id>` anchor).
- **Multi-channel admin notification** on submission: in-app bell for every admin, email to ADMIN_EMAIL, Telegram alert via `@furqantoday_bot`. Each fail-open.

### Added — Admin user management

- **Delete + Restore buttons** on `/admin/users` rows, wiring the long-existing `softDeleteUser` / `restoreUser` server actions to the UI (they had no surface before). Self-protection: admin row shows "(you)" instead of Delete.
- **Inline error microcopy** on the platform settings feature toggles.

### Added — No-silent-failures defense system

- **`src/lib/actions/loud.ts`** — wrapper for server actions; auto-logs every throw, fires Telegram on `severity='critical'`, writes `audit_log` on success AND failure. Returns consistent `{ ok, message?, error? }` shape.
- **`src/components/shared/action-feedback.tsx`** — drop-in renderer for `useActionState` results (green banner on success, red on error).
- **Vitest enforcer** — `src/lib/supabase/no-silent-fails.test.ts` scans every `.ts`/`.tsx` for unhandled mutations; CI fails any PR introducing a new one.
- **Failures filter** on `/admin/audit`; **"Failed Admin Actions (24h)" widget** on `/admin/control-tower`.
- **Telegram alert on critical errors** — `logError(..., { severity: 'critical' })` now buzzes the operator.
- **Every route `error.tsx` boundary now logs to Sentry** (5 boundaries: root + admin + student + teacher + moderator). Admin tagged critical.
- **14 silent-fail Supabase mutations fixed** across admin/teachers, blog, contacts, packages, services, reviews, users, stripe (fulfillment + refund + checkout), teacher dashboard, follow-up auto-regen.

### Added — Database hardening (B+ → A++)

- **`v15_001`** — 12 FK supporting indexes + dropped 2 duplicate indexes from prior renames.
- **`v15_002`** — PII redaction trigger on `audit_log` (masks email/phone/parent_*/dob/avatar_url before insert).
- **`v15_003`** — tightened anon RLS on `platform_settings` (was wide-open) and `teacher_profiles` (anon now only sees `cv_status='approved'` + accepting + non-archived).
- **`v15_004`** — invariant triggers: auto-create `teacher_profiles` when `profiles.role` flips to teacher; auto-archive on soft-delete; auto-restore on undelete. Ahmed-class bugs are now structurally impossible.
- **Daily reconciliation cron** at 03:00 Kuwait — `/api/cron/reconciliation` runs 3 invariant checks, Telegrams findings, silent on clean runs.
- **Generated types as source of truth** — `src/types/database.ts` rebuilt as a thin re-export over `supabase.generated.ts` (901 lines deleted). `npm run db:types` regenerates from live schema.

### Added — CI defense (zero existing workflows → 4)

- **`.github/workflows/supabase-lint.yml`** — `supabase db lint --linked` on every migration PR.
- **`.github/workflows/migration-drift.yml`** — fails the build if any repo migration file isn't applied to production. Bonus: warns if migrations were applied out of file-version order.
- **`.github/workflows/db-types-fresh.yml`** — fails the build if `supabase.generated.ts` is stale vs production.
- **`.github/workflows/rls-tests.yml`** — runs `npm run test:unit` (RLS regression suite + silent-fail enforcer + others). Anon-key + service-role-token GitHub Secrets configured.

### Fixed

- **`bio_en` column never applied to production** — migration `v14_006` existed in repo but never ran. Fixed during the audit; all 8 code paths referencing `bio_en` now work.
- **Admin-created teachers stuck with `cv_status='draft'`** — Ahmed Sokar incident. Default flipped to `approved` for admin-created teachers (self-applied via `/teach/apply` still go to `pending_review`). Backfilled affected rows.
- **Public `/teachers-page` missing `cv_status='approved'` filter** — would have shown un-vetted teachers if `is_accepting=true`. Now correctly gated.
- **n8n Health Audit panel "limit must be ≤ 250" 400 error** — paginated via `nextCursor` instead of one big request.
- **Vercel auto-deploys silently rejected** for 24h — root cause was sub-daily crons (`*/30`, `*/5`) violating Hobby plan limit. Moved those to n8n; auto-deploy now works.
- **WhatsApp number** updated to +965 9779 5626 across 3 files.

### Operational

- **Supabase access token rotated** twice this session (visible-in-transcript hygiene).
- **CLI link** restored — `supabase migration list --linked` works.
- **Resend domain `furqan.today` verified** with DKIM/SPF/DMARC; emails sent from `noreply@furqan.today` instead of sandbox sender.

### Added — Autonomous follow-up pass (continuation)

- **`/contact` form gated by Vercel BotID** — last unprotected high-value public endpoint. Joined the `/login`, `/register`, `/student/bookings/new`, `/teach/apply` set with invisible CAPTCHA on the page route + `checkBotId()` in the server action.
- **6 more silent-catch surfaces patched** across `n8n.client.sendTelegramAlert`, admin `endSession` notify-broadcast, admin `sendNotification` dispatch loop, admin `pingAdminOnEvaluation`, `createEvaluation`/`createTeacherEvaluation` notify, `createHomework`/`markStudentReady`/`gradeHomework` notify + auto-regen, `submitContactForm` whatsapp + email side-channels. Each preserves non-blocking semantics but routes failures through `logError` so they reach Sentry/Telegram/console instead of vanishing.
- **a11y** — icon-only delete in admin services row now has `aria-label`, `title`, `type="button"`, and focus ring.

### Fixed — Lint to zero (10 errors → 0 / 0 warnings)

- **`react-hooks/purity` false positives in 7 server-component pages** — scoped an off-rule override in `eslint.config.mjs` to `src/app/**/page.tsx` + `layout.tsx`. Server components run once per request (not per render), so `Date.now()` is intentionally request-scoped there. Client components remain covered by the rule via the global config. Dropped two now-redundant per-line disable comments.
- **`react-hooks/set-state-in-effect` in `pwa-install-prompt.tsx`** — wrapped `setDismissed(true)` in `startTransition` so the sessionStorage→state sync is marked non-urgent (matches the earlier `site-announcement-dismiss.tsx` pattern).
- **`react/no-unescaped-entities` in `ijazas-editor.tsx`** — replaced inline ASCII quotes with `&quot;` entities.
- **Stale closure in `execution-intel-tab.tsx`** — added missing `locale` dep to `useMemo`; AR↔EN day labels now refresh correctly when language toggles.

### Out of scope / deferred

- Supabase Branching activation (needs human OAuth grant)
- Backup-restore rehearsal (needs supervised local Postgres)
- Sentry DSN setup (needs free account creation)
- Pro-tier features (PITR, read replica) — billing
- Per-service DB roles, full ActionFeedback migration to all forms

## 2026-04-23 — Retention system + Sprint 1/8 prep

Shipped 16 commits in a single session taking the retention feature from skeleton to self-healing, plus scaffolding two blocked sprints so they collapse to SDK-only work once keys arrive.

### Added — Retention (Sprint 5 app-side, plus polish phases)

- **`/api/retention/score`** endpoint. Daily scorer that computes `engagement_score` + `churn_risk_score` per student and upserts into `retention_signals`. Called by n8n cron on the Mac mini. Writes batch runs to `automation_logs` for observability.
- **`/admin/retention`** page. Ranked at-risk table with 5 intervention types (urgent contact, renewal offer, expiry reminder, re-engagement, weekly followup). Each intervention logs to `automation_logs` for audit trail and stamps `retention_signals.last_intervention_at`. Scorer's cooldown multipliers (×0.5 within 2 days, ×0.75 within 7 days) prevent over-contact. URL-param filters for risk tier / package state / intervention freshness.
- **Control Tower widget** — count of students with `churn_risk_score >= 60`, linked to retention page.
- **Risk badges** on `/admin/users` list + retention card on `/admin/users/[id]` with collapsible intervention history (last 10).
- **Risk hints on session detail pages** — admin, teacher, moderator session detail pages show the student's risk badge (only for ≥40).
- **Teacher at-risk widget** on teacher dashboard — shows this teacher's own students at risk, read-only.
- **Moderator at-risk widget** on moderator dashboard — platform-wide top 5.
- **Run Scorer Now button** — admin can manually trigger the scorer instead of waiting for cron.

### Added — Sprint 6 (teacher compliance)

- **Health metrics card** on `/admin/teachers/[id]` — 90-day punctuality, grading lag, evaluation completion rate, no-show rate, color-coded against thresholds.

### Added — Sprint 1 scaffolding (no SDK install required)

- **`src/lib/stripe/fulfillment.ts`** — `fulfillPackagePurchase()` creates Payment + StudentPackage + Invoice with best-effort rollback on failure.
- **`src/lib/stripe/refund.ts`** — `creditBackSession()` restores `sessions_used` via existing package state and writes a `payment_transactions` audit row.
- **`/api/stripe/webhook`** — full event router handling `checkout.session.completed`, logs every event to `automation_logs`. Signature verification stays as TODO pending SDK install.

### Added — Sprint 8 scaffolding (parent reports, AI-swappable slot)

- **`src/lib/reports/session-narrative.ts`** — `buildSessionNarrative(sessionId)` assembles structured report from session notes + follow-up + evaluation. The `narrative_paragraph` field is AI-swappable — template today, Claude tomorrow, no surrounding shape change.
- **`/api/reports/session/[id]`** (GET) — dual-auth (X-N8N-Secret or cookie admin/teacher) for n8n + UI inspection.
- **`/api/reports/session/[id]/send`** (POST) — accepts optional `narrative_paragraph` body override, runs dispatcher + writes `parent_reports` + emits `session.report_sent`.
- **Idempotency guard** — `automation_logs` prevents duplicate sends across admin button + n8n workflow + future Vercel Cron.
- **Admin "إرسال تقرير للوالد" button** on `/admin/sessions/[id]` once session has ended.

### Fixed

- **Blog OG route 1.01 MB Edge Function size limit.** Moved from `runtime="edge"` to Fluid Compute (default), added `dynamic="force-dynamic"` to skip prerender (Arabic `substFormat: 3` font feature breaks at build). Resolves ~1 hour of cascading production deploy failures.
- **`.claude/scheduled_tasks.lock` + `.claude/plans/` tracked by mistake** — now in `.gitignore`, skills stay tracked.

### Changed

- Documented that n8n moved from VPS to a Mac mini (`CLAUDE.md` + `automation/VPS_HANDOFF.md`). Endpoint `n8n.drdeeb.tech` unchanged.
- `ROADMAP.md` now marks Sprints 2-7 as ✅ SHIPPED and adds a Post-Roadmap Phases table for the new work.

### Patterns established

- **AI-swappable slot** — isolate generative output behind one field so swap from template to AI is a one-field change.
- **Shared retention helpers** (`src/lib/retention/ui.ts`) — extracted at the third caller per the Rule of Three.
- **Dual-auth endpoints** — `X-N8N-Secret` OR cookie role check on the same handler, one handler serves both n8n server-to-server and admin UI.
- **`automation_logs` as observability + idempotency store** — saves a schema migration for every audit need.
- **Fast-read cache + slow-write log** (`retention_signals.last_intervention_at` vs `automation_logs`) — CQRS at the table level without event sourcing overhead.

### Still blocked

- **Sprint 1 completion** — install `stripe` package, uncomment signature verification block, set env vars. ~15 min once keys arrive.
- **Sprint 8 AI narrative** — n8n workflow that calls Claude and POSTs to `/api/reports/session/[id]/send` with `narrative_paragraph` override. No app changes required.
- **n8n workflows on Mac mini** — retention daily cron, intervention fan-out, grading follow-up, eval compliance. All triggered off `POST` to existing app endpoints.
