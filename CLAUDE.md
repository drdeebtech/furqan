@AGENTS.md

# currentDate
Today's date is 2026-04-10.

# Git Identity Rule

Before making ANY git commit, you MUST ensure the git author matches the GitHub account:
```
git config user.email "drdeebtech@gmail.com"
git config user.name "drdeebtech"
```
Run this at the start of every conversation before committing. Vercel Hobby plan blocks deployments from unrecognized git authors on private repos. Do NOT rely on the machine default identity.

# Deployment Rules

- **Platform**: Vercel Hobby plan → furqan.today
- **Node version**: 24.x (set in `.nvmrc` and `package.json` `engines`, matching the Vercel project setting). Aligned 2026-04-27 — was previously split (`.nvmrc=20`, project=`24.x`).
- After pushing, verify deployment status: `npx vercel ls furqan --prod`
- If deployment is "Blocked", check git author email matches `drdeebtech@gmail.com`
- The `vercel.json` has `installCommand: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install"` — do not remove this
- Edge functions in `supabase/functions/` are excluded from `tsconfig.json` (Deno imports)
- **Cron jobs go on n8n, not Vercel.** Vercel Hobby caps `vercel.json` crons at one invocation per day per entry — a `*/30 * * * *` (or any sub-daily) entry causes Vercel to silently reject every subsequent build with `"Hobby accounts are limited to daily cron jobs"`, but the rejection is invisible in `vercel ls` (rejected builds never enter the queue), so this looks like a broken GitHub→Vercel webhook. Keep route handlers under `src/app/api/cron/*/route.ts` (the existing dual-auth `Authorization: Bearer ${CRON_SECRET}` + `X-N8N-Secret: ${N8N_WEBHOOK_SECRET}` pattern in `audit-cleanup/route.ts` is the canonical shape) and trigger from n8n on the Mac mini. The current daily Vercel crons (audit-cleanup, reconciliation, email-health) can stay; do not add new ones unless the schedule is exactly daily.

# Scale Target Rule (NON-NEGOTIABLE)

FURQAN is being built for **50,000 users**. Every plan, design, and implementation choice MUST be sized for that number from day one — not for "today's traffic" with a "we'll optimise later" intent. Late-stage retrofitting at 50k user scale is dramatically more expensive than getting it right up front.

**Concrete obligations (apply before agreeing to any approach):**

- **Performance budgets** — P95 latency, DB query plans, dashboard waterfalls, and bundle sizes must hold under ~50k DAU. Don't trust dev-time perf as a proxy.
- **Write-amplification audit** — every "small column we'll update on each request" is a 250k-write/day decision at 50k DAU. Before adding a column that updates per page render, ask whether the same signal exists on a column that's already being written.
- **No bulk-fan-out admin actions** — admin actions that fan out to N student rows turn into 10M-row UPDATEs at scale. Push state to per-row data with localised writes; admin-tunable settings should change defaults for *new* rows only, not retroactively rewrite existing rows.
- **Returning-user UX** — backlog-shaming patterns ("you have 47 things to catch up") destroy retention at scale. Default to forgiving variants; route deep gaps to teacher-side panels rather than student-facing remediation cards.
- **Teacher infrastructure is load-bearing** — when a student falls behind, route the signal to the teacher panel. Don't try to make the app replace a human teacher.
- **Cron / batch sizing** — nightly jobs at 50k × ~200 rows/student ≈ 10M row-touches per night. Size n8n workflows, Postgres functions, and Supabase indexes accordingly. Avoid sub-daily Vercel crons; n8n on the Mac mini handles sub-daily.
- **Hot-path JOINs** — every dashboard render at 50k DAU × ~5 hits/day = 250k reads/day. Each extra JOIN on the hot path multiplies that. Push provenance / versioning columns onto the row itself rather than a join target.
- **RLS at scale** — multi-tenant policies must be load-tested, not just dev-tested. RLS predicates that work fine on a 100-row table can degrade catastrophically on a 10M-row table without the right index.

**Conflict / drift policy:**

If a plan, PR, proposed approach, slash command, or agent recommendation conflicts with the 50k target — **stop and notify the operator before proceeding**. Don't quietly accept a "this is fine for now" path that creates retrofit debt.

Examples of conflicts that warrant notification:
- A new feature that synchronously calls a third-party API per dashboard render.
- A migration that adds an unbounded scan or a unique index on a low-selectivity column.
- An admin action that does an unbounded UPDATE on schedule, evaluation, or progress tables.
- A spec, ADR, or PRD that implicitly assumes "few hundred users" performance.
- Recommended option A vs. B is identical at small scale but A becomes a write storm at 50k.

Notification format: state the conflict explicitly, name the alternative that fits 50k, and ask before continuing. Do NOT silently switch the choice — operator decides.

**Cross-references:**

- `.specify/memory/constitution.md` Additional Constraints section MUST mirror this rule so `/speckit.plan` and `/speckit.analyze` enforce it on every feature spec.
- Memory file `~/.claude/projects/-Users-drdeeb-furqan/memory/project_furqan_scale.md` carries the same rule into future Claude Code sessions.
- This rule supersedes any default sizing assumption in `.impeccable.md`, `ROADMAP.md`, or older docs that predate the 50k commitment.

# Branch Hygiene Rule (NON-NEGOTIABLE)

Every branch ends with a Pull Request OR a deletion. There is no third state. Stale local-only branches that "might be useful later" are how 33+ zombie branches accumulated in this repo before the 2026-05-08 audit; the rule below prevents recurrence.

**The four don'ts (apply to every commit, no exceptions):**

1. **Don't commit on whatever branch happens to be checked out.** Always run `git checkout main && git pull --ff-only && git checkout -b <name>` before starting any new work. The pattern that breaks this rule is how the 2026-05-07 fix-189 cast-cleanup ended up on a branch labeled "B3.4 design"; commits get orphaned and audits can't trace them.

2. **Don't make "v2" branches.** If a branch is going stale, push it as a PR (draft is fine) or delete it. Never make `chore/repo-audit-v2` after `chore/repo-audit-bucket` — the 2026-05-08 audit found three branches of `audit-v*` with identical SHAs racing to ship the same work; none of them did.

3. **Don't push speculative WIP to remote unless you'll PR it the same day.** A WIP commit that lives only locally for 2+ days is WIP for the bin. The image-captioning edge function (406 lines) sat as `wip/parallel-work-checkpoint` for 2 days, then got dropped at audit time because the path-to-ship was never clear. If unsure it's shippable, don't commit; if you commit, open a draft PR same day.

4. **Don't fix the same thing twice without checking the first attempt.** The 2026-05-08 audit found 8 cases of re-fix-without-checking. One of them (`fix/auth-smoke-vercel-bypass`) would have re-introduced a feature that PR #121 explicitly removed as "chronically red." Pre-work check is 30 seconds and catches every case.

**Pre-work checks (run before starting any fix):**

```bash
gh issue view <N>                              # is the issue still open?
gh pr list                                     # is there an in-flight PR?
git log main --oneline --grep="<topic>"        # has it shipped under another PR?
git log main --diff-filter=D --oneline -- <file>   # was it deliberately removed?
```

The fourth check (`--diff-filter=D`) is the one that catches *retired* work — code that was on main, then someone deliberately deleted it. Without that check, "the file isn't on main" looks identical to "this is greenfield work."

**Same-day discipline:**

- Push and open PR (draft is fine) the same day you start coding.
- Use `Closes #N` (or `Fixes`, `Resolves`) in the PR body so the issue auto-closes on merge.
- After merge, GitHub auto-deletes the source branch (`delete_branch_on_merge: true` is enabled at the repo level). Never re-push to a merged branch — name a new one.

**Conflict / drift policy:**

If you find yourself about to: commit on `feat/something-else` instead of a fresh branch; create a `v2` of an existing branch; push WIP without a same-day PR; or start a fix without checking whether it's already shipped or removed — **stop and notify the operator before proceeding.** State the conflict, suggest the alternative, ask before continuing. Do NOT silently work around it.

**Cross-references:**

- `.specify/memory/constitution.md` Additional Constraints section MUST mirror this rule so `/speckit.plan` and `/speckit.analyze` enforce it on every feature spec.
- Memory file `~/.claude/projects/-Users-drdeeb-furqan/memory/feedback_branch_hygiene.md` carries this rule into future Claude Code sessions.
- Audit that surfaced these patterns: 2026-05-08 (closed PRs #217, #218; deleted ~33 stale branches).

# Project Overview

FURQAN Academy — Online Quran teaching platform (V13)

**Current phase:** Platform hardening & operational leverage (post-audit)
**Audit report:** `AUDIT.md` — full platform audit with grades and recommendations
**Implementation roadmap:** `ROADMAP.md` — 8 sprints from P1 to P4

## Stack
- **Next.js 16.2.2** (App Router, Turbopack) · **React 19** · **TypeScript 5**
- **Supabase** (PostgreSQL 17, Auth, RLS, Realtime) · **@supabase/ssr**
- **Daily.co** (Video sessions + observer mode)
- **Stripe** (Payments — schema ready, checkout flow deferred until API keys provided)
- **TailwindCSS 4** · **next-intl** (i18n, Arabic/English)
- **n8n** (n8n.drdeeb.tech — 44+ active automation workflows)
- **Telegram** (@furqantoday_bot — admin alerts + notifications)
- **Deployed on Vercel** (Hobby plan, furqan.today)

## Roles (3)
Per ADR-0003 (2026-05-08), the moderator role was dropped. CV review, audit log, session observation, and user management — all formerly moderator surfaces — are now admin-owned.

- **student** — browse teachers, book sessions, join video, track progress, follow-up, packages, messages
- **teacher** — manage availability, confirm bookings, conduct sessions, assign/grade follow-up, CV workflow, evaluations, messages
- **admin** — full platform management: users, teachers, bookings, sessions, evaluations, packages, services, blog, payments, notifications, automation, n8n control, settings, CV review, audit log, session observation

## Domain Ownership Model

| Domain | Source of Truth | Key Tables | Owner Actions |
|--------|----------------|------------|---------------|
| **Booking** | `bookings` table | bookings, teacher_availability, availability_exceptions | createBooking, updateBookingStatus |
| **Session** | `sessions` table | sessions, session_observers | endSession, markNoShow, savePostSessionNotes |
| **Follow-up** | `homework_assignments` table | homework_assignments | createHomework, markStudentReady, gradeHomework |
| **Progress** | `student_progress` + `session_evaluations` | student_progress, recitation_errors, session_evaluations | createEvaluation, createTeacherEvaluation |
| **Package** | `packages` + `student_packages` | packages, student_packages, payments, invoices | deduct_package_session(), Stripe webhook |
| **Communication** | `notifications` + `parent_reports` | notifications, parent_reports, messages, conversations, message_delivery_log, communication_preferences | dispatchNotification(), notify(), parent notifications |
| **Automation** | `automation_logs` | automation_logs, platform_settings, retention_signals | emitEvent(), n8n webhook callback |

## Key Architecture
- **Route protection**: `src/proxy.ts` — role-based middleware. Legacy `/moderator/*` URLs 301-redirect to `/admin/*` (per ADR-0003); `/moderator/cv-review` → `/admin/teachers/cv` specifically.
- **Server actions**: `"use server"` pattern with `revalidatePath`, `as never` casts for Supabase
- **Admin client**: `src/lib/supabase/admin.ts` — service-role client for user creation
- **Feature flags**: `src/lib/settings.ts` + `platform_settings` table
- **Parent notifications**: `src/lib/notifications/parent.ts` — report system for parents
- **Notification dispatcher**: `src/lib/notifications/dispatcher.ts` — multi-channel with preferences, quiet hours, delivery logging to message_delivery_log
- **Session observation**: Daily.co observer tokens with mic/camera off, max_participants bumped to 3
- **Follow-up system**: `src/lib/actions/homework.ts` — 5 server actions with state machine and auto-regeneration
- **Event emission**: `src/lib/automation/emit.ts` — non-blocking webhooks to n8n with per-event routing
- **n8n callback**: `src/app/api/webhooks/n8n/route.ts` — log, notify, idempotency check
- **n8n REST client**: `src/lib/n8n/client.ts` — workflows, executions, toggle, Telegram alerts
- **n8n control panel**: `/admin/n8n` — view/toggle/search/filter/auto-restart all n8n workflows
- **n8n instance**: n8n.drdeeb.tech (self-hosted on Mac mini) — **44+ active FURQAN workflows** across 9 areas
- **Telegram bot**: @furqantoday_bot — auto-restart alerts, failure notifications, admin digests
- **Notification bell**: `src/components/shared/notification-bell.tsx` — topbar dropdown with unread count
- **Admin control tower**: `/admin/control-tower` — 7 real-time operational widgets with alert badges
- **Teacher action queue**: `src/app/teacher/dashboard/action-queue.tsx` — prioritized pending tasks
- **PWA**: `public/sw.js` — service worker + install prompt

## Database (44 tables)
Original 20 tables + 5 V9 tables + 2 V10 tables + 2 V11 tables + 1 V12 table + 3 V13 tables + 11 V17 tables (15-feature build).

V9: platform_settings, session_evaluations, parent_reports, session_notes_history, session_observers
V10: services, homework_assignments
V11: packages, student_packages
V12: automation_logs
V13: message_delivery_log, communication_preferences, retention_signals
V17 (15-feature build, 2026-04-29):
  - study_log — Time Tracker
  - help_articles, help_categories — Help Center CMS
  - resources — Resources library
  - modules, module_lessons — Curriculum modules with linear/thematic gating
  - quizzes, quiz_questions, quiz_attempts — Quiz system (text-only auto-graded)
  - forum_threads, forum_replies, forum_likes, forum_reports — Community forum

Plus added columns: course_lesson_progress.hidden_from_dashboard, sessions.lesson_plan (jsonb).

Migration files: v9_001, v10_001, v10_002, v11_001, v12_001, v13_001, v13_002 (legacy under src/lib/supabase/migrations/), then timestamped at supabase/migrations/ from 2026-04-26 onwards.

## Enums (26 total)
Postgres ENUMs: user_role, gender_type, booking_status, session_type, payment_status, msg_type, notif_type, student_level, cv_status, evaluation_type, report_type, homework_type, homework_status
Text CHECK: package_type, student_package_status, automation_log_status, delivery_channel, delivery_status, preferred_language, conversation_status, credit_source, progress_type, recitation_error_type, transaction_type, session_created_via, audit_action, recitation_standard

## SQL Functions
- `is_admin()` (per ADR-0003 — `is_moderator` and `is_admin_or_mod` were dropped along with the moderator role)
- `deduct_package_session(uuid)` — atomic session deduction
- `set_updated_at()` — trigger function
- `sync_conv_ts()` — auto-update conversation timestamps

## Events Emitted (to n8n)
booking.created, booking.confirmed, booking.cancelled, session.ended, session.no_show, session.notes_saved, homework.assigned, homework.student_ready, homework.graded, evaluation.created

**Webhook routes** (in emit.ts):
- booking.confirmed → /webhook/furqan-booking-confirmed
- session.notes_saved → /webhook/furqan-session-notes-saved
- session.no_show → /webhook/furqan-no-show-parent
- homework.graded → /webhook/furqan-homework-graded
- profile.created → /webhook/furqan-profile-created
- teacher.cv_* → /webhook/furqan-cv-event

## n8n Workflows (44+ active)

| Area | Count | Key Workflows |
|------|-------|---------------|
| Session Lifecycle | 7 | health-check, failure-sentinel, reminder-engine, room-creation, no-show, auto-decline, auto-complete |
| Parent Communication | 4 | post-session-report (AI+fallback), missed-session-alert, homework-alert, weekly-digest |
| Student Retention | 7 | low-balance, expiry-countdown, renewal, abandoned-booking, inactivity, at-risk, milestones |
| Teacher Management | 5 | quality-monitor, onboarding-nudges, cv-approval, eval-compliance, welcome |
| Admin Operations | 2 | daily-digest, kpi-alerting |
| Revenue | 3+ | upsell, lapsed-return, trial-to-paid, teacher-payout |
| Booking Intelligence | 3+ | conflict-detector, recurring-booking, waitlist-fill |
| Messaging | 3+ | moderation, announcement-broadcaster, telegram-admin-bot |
| Platform Health | 3+ | old-data-cleanup, broken-link-check, credential-watcher |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key |
| `NEXT_PUBLIC_APP_URL` | App base URL |
| `DAILY_API_KEY` | Daily.co video rooms |
| `RESEND_API_KEY` | Email sending |
| `ADMIN_EMAIL` | Admin notification email |
| `N8N_WEBHOOK_URL` | n8n base URL (https://n8n.drdeeb.tech) |
| `N8N_WEBHOOK_SECRET` | Shared secret for n8n callbacks |
| `N8N_API_URL` | n8n REST API (https://n8n.drdeeb.tech/api/v1) |
| `N8N_API_KEY` | n8n API key for control panel |
| `TG_BOT_TOKEN` | Telegram bot @furqantoday_bot |
| `TG_ADMIN_CHAT_ID` | Admin Telegram chat (707213038) |
| `STRIPE_SECRET_KEY` | Stripe payments (deferred) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe client (deferred) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook (deferred) |
| `SENTRY_DSN` | Sentry server/edge ingest (DE region) |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry browser ingest (publicly bundled) |
| `CRON_SECRET` | Bearer token gating `/api/cron/*` against unauthenticated hits |
| `RESEND_FROM_EMAIL` | "From" header for transactional email |
| `N8N_HEALTHCHECK_URL` | Endpoint hit by `/api/cron/n8n-healthcheck` |
| `NEXT_PUBLIC_N8N_UI_URL` | Link target from `/admin/n8n` to the n8n UI |
| `CALLMEBOT_KEY_EG` | CallMeBot API key (Egypt WhatsApp routing) |
| `CALLMEBOT_KEY_KW` | CallMeBot API key (Kuwait WhatsApp routing) |
| `CALLMEBOT_PHONE_EG` | CallMeBot recipient phone (Egypt) |
| `CALLMEBOT_PHONE_KW` | CallMeBot recipient phone (Kuwait) |
| `BUNNY_STREAM_API_KEY` | Bunny.net Stream library API key (server-only; never sent to client) |
| `BUNNY_STREAM_LIBRARY_ID` | Bunny.net Stream library numeric ID |
| `BUNNY_STREAM_PULL_ZONE_HOSTNAME` | Bunny CDN pull-zone hostname for video playback (e.g. `vz-12345678-abc.b-cdn.net`) |
| `BUNNY_STREAM_TOKEN_AUTH_KEY` | Bunny CDN token-auth key for signing playback URLs |
| `BUNNY_WEBHOOK_SECRET` | Bunny.net webhook HMAC SHA256 signing secret (verifies status callbacks) |
| `PAYPAL_CLIENT_ID` | PayPal app client ID — server-side and surfaced as NEXT_PUBLIC_PAYPAL_CLIENT_ID for the SDK loader |
| `PAYPAL_CLIENT_SECRET` | PayPal app client secret — server-only, used for OAuth client-credentials grant |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Same value as `PAYPAL_CLIENT_ID`; needed in the browser by `@paypal/react-paypal-js` |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` (sandbox) or `https://api-m.paypal.com` (live). Defaults to sandbox if missing |
| `SENTRY_WATCH_SECRET` | Shared bearer token for `POST /api/sentry-watch/notify`. The hourly Claude Code Sentry-watcher cron presents it; the endpoint validates against it before sending the WhatsApp triage alert |
| `BOTID_BYPASS_EMAILS` | Comma-separated allow-list of admin emails that skip BotID on `/login` + `/register`. Emergency-glass when the BotID client SDK fails to mint a token in a specific browser. The per-email rate limiter (10/hr) still gates stuffing attempts. Optional — leave unset to enforce BotID for everyone |

> This table is the source of truth. If you add `process.env.X` to code, add `X` here in the same PR. Run `npx vercel env ls` to verify each is set in Production / Preview / Development.

## Coding Patterns
- All server actions use `"use server"` directive
- Use `as never` for Supabase `.insert()` / `.update()` calls
- Use `.returns<Type[]>()` for queries on V10+ tables
- Use `useActionState` from `"react"` (NOT from `"react-dom"`)
- Use `startTransition` for setState inside useEffect (React compiler compliance)
- All user-facing text in Arabic, bilingual labels optional (Arabic + English hint)
- `revalidatePath()` after every mutation
- Audit logging for admin destructive actions
- **All notifications must go through `notify()` or `dispatchNotification()`** — never insert directly into notifications table
- **All event-emitting server actions must call `emitEvent()`** from `src/lib/automation/emit.ts`

## File Structure (key paths)
```
src/
├── app/
│   ├── (auth)/          — login, register, forgot-password
│   ├── (public)/        — landing, about, contact, packages, services, teachers, blog
│   ├── admin/           — 35+ pages: users, teachers (incl. cv review), bookings, sessions, evaluations, audit, packages, services, blog, payments, notifications, automation, n8n, control-tower, settings
│   ├── student/         — 12+ pages: dashboard, teachers, bookings, sessions, follow-up, packages, progress, notifications, messages, notes
│   ├── teacher/         — 11+ pages: dashboard, sessions, availability, students, follow-up, cv, evaluations, notifications, messages
│   └── api/             — stripe webhook, bookings, n8n (workflows/executions/toggle/auto-restart), webhooks/n8n
├── components/
│   ├── shared/ (20+)    — nav, topbar, notification-bell, stat-card, widget-card, data-table, analytics-chart, breakdown-bar, live-sessions-widget, messages-view, pwa-install-prompt
│   ├── public/ (9)      — public-nav, public-footer, testimonials, register-banner, whatsapp-button
│   └── seo/ (1)         — structured-data
├── lib/
│   ├── supabase/        — client.ts, server.ts, middleware.ts, admin.ts, helpers.ts, migrations/
│   ├── actions/         — evaluations.ts, homework.ts, notifications.ts
│   ├── automation/      — emit.ts (event emission to n8n with per-event routing)
│   ├── notifications/   — parent.ts, dispatcher.ts
│   ├── n8n/             — client.ts (REST API client for n8n control)
│   ├── stripe/          — .gitkeep (Stripe integration deferred)
│   ├── i18n/            — context.tsx, lang-toggle.tsx
│   ├── theme/           — context.tsx, theme-toggle.tsx
│   ├── daily.ts, email.ts, whatsapp.ts, settings.ts, constants.ts, dashboard-queries.ts, cn.ts
│   └── feature-flags-context.tsx
├── types/
│   └── database.ts      — 33 table interfaces, 26 enums (~1022 lines)
└── proxy.ts             — middleware route protection
automation/
├── BLUEPRINT.md         — 52-workflow master plan (12 areas)
├── VPS_HANDOFF.md       — Legacy context (n8n was on VPS, now on Mac mini — kept for history)
└── VPS_ANSWERS.md       — Legacy setup answers and credentials checklist
supabase/functions/      — 4 edge functions (auto-reminder, auto-complete, no-show-detector, weekly-report)
```

## Completed Features

### Feature Development (Phases A–I)
- 3 role dashboards with real Supabase data + shared widget system
- Bilingual RTL/LTR with Arabic/English toggle + dark/light mode (Liquid Glass Design System v3)
- Database schema V9→V13 (sessions, evaluations, follow-up, packages, automation, communication, retention)
- Blog CMS, SEO, RLS policies
- CV review workflow (admin)
- Basic booking + sessions with Daily.co video
- **Follow-up system** (V10) — state machine, 6 types, grading, auto-regeneration
- **Package & pricing** (V11) — DB-driven packages, admin CRUD, 5 seed packages, student view
- **In-app notifications** — bell + dropdown + full pages + mark-read/delete
- **Student progress** — juz tracker, eval chart, milestones, follow-up performance
- **Teacher onboarding** — 5-step checklist with progress bar, CV in nav
- **Student discovery** — gender/specialty filter, sort controls
- **Messaging** — read receipts, unread counts, message notifications
- **PWA** — service worker, install prompt, iOS meta tags
- **Automation infrastructure** (V12) — automation_logs, event emission, n8n webhook endpoint, admin dashboard, feature flags

### Hardening (Post-Audit)
- **Communication infrastructure** (V13) — message_delivery_log, communication_preferences, notification dispatcher with quiet hours
- **Notification migration** — all direct notification inserts replaced with `notify()` dispatcher
- **Event catalog + lifecycle docs** — EVENT_CATALOG.md, LIFECYCLES.md (7 state machines)
- **Teacher action queue** — prioritized pending tasks on teacher dashboard
- **Retention signals table** — churn scoring foundation
- **Admin control tower** — 7 operational widgets with alert badges
- **Dashboard performance** — reduced Supabase round-trips from 5-7 to 2-3 per dashboard
- **Audit fixes** — 28 issues resolved (accessibility, performance, theming, responsive)
- **n8n control panel** — `/admin/n8n` with workflow view/toggle/search/filter/auto-restart + Telegram alerts

### n8n Automation (VPS)
- **44+ active workflows** on n8n.drdeeb.tech across session lifecycle, parent communication, retention, teacher management, admin operations, revenue, booking, messaging, platform health
- **Credentials configured**: Supabase, Daily.co, Resend, Telegram (@furqantoday_bot)
- **Self-healing**: auto-restart failed workflows with Telegram notification

## Remaining Work

### Blocked (needs external input)
1. **Stripe payment flow** — needs Stripe API keys to complete checkout + webhook + fulfillment
2. **AI workflows** — needs Anthropic API key in n8n for AI parent reports, curriculum advisor
3. **WhatsApp Business** — needs WhatsApp Cloud API token for parent messaging
4. **Google Calendar sync** — needs OAuth setup for teacher calendar integration

### Feature Flags (toggle from /admin/settings)
- `automation_enabled` = true
- `whatsapp_enabled` = true
- `ai_parent_reports_enabled` = false (enable when AI key ready)
- `teacher_quality_monitor_enabled` = false (enable when confident)
- `retention_automation_enabled` = false (enable when confident)
- `renewal_campaigns_enabled` = false

### Infrastructure improvements
- Set up Supabase Branching so Preview deployments get an isolated, ephemeral database (not the production one). Resolves the "Preview database isolation — known gap" risk. ~30min one-time setup, then per-PR branches auto-spin.

## Documentation Files
| File | Purpose |
|------|---------|
| `CLAUDE.md` | This file — AI assistant instructions |
| `.impeccable.md` | **Design Context — read before any UI work.** Brand personality, references/anti-references, principles, tokens, components. |
| `.github/copilot-instructions.md` | Synced summary of `.impeccable.md` for Copilot/Vercel Agent surfaces |
| `PROJECT.md` | Full technical reference (563 lines) |
| `AUDIT.md` | Platform audit report (433 lines) |
| `ROADMAP.md` | Implementation roadmap — 8 sprints (404 lines) |
| `EVENT_CATALOG.md` | Event taxonomy — 9 active + 13 planned |
| `LIFECYCLES.md` | 7 state machine diagrams |
| `automation/BLUEPRINT.md` | 52-workflow master plan |
| `automation/VPS_HANDOFF.md` | n8n VPS session context |
| `.specify/memory/constitution.md` | Five-principle constitution checked by `/speckit.plan` and `/speckit.analyze` |
| `specs/<feature>/spec.md` | Per-feature spec produced by `/speckit.specify`; one folder per net-new feature |

> **Design rule for AI sessions:** before touching any visual surface (component, page, theme, color), open `.impeccable.md` and confirm the change aligns with the **Premium · Refined · Authentic** personality and the four explicit anti-references. The platform serves all ages from children to hāfiz; the brand stays dignified across all of them.

## Spec-Kit Workflow

Net-new features run through spec-kit before implementation; emergent architectural decisions during implementation continue to land as ADRs.

**Use spec-kit when:**
- Introducing a new owner-domain or a new role surface.
- Roadmap-level scope (P0/P1 in `ROADMAP.md`) or multi-PR effort.
- A feature whose ambiguity needs to be flushed before code lands.

**Use ADR-only when:**
- Refactoring existing code (e.g. ADR-0002, ADR-0004).
- Mid-implementation pivot or unforeseen constraint.
- Hotfix or single-PR fix.
- Documenting a decision the team made on a call.

**Cross-reference:** a `spec.md` may cite ADRs it depends on; an ADR may cite the spec it implements (`specs/<feature>/spec.md`). Both can coexist for one feature without duplication.

**Workflow:**
1. `/speckit.specify "<one-paragraph feature description>"` — generates `specs/<NNN-feature-slug>/spec.md` on a fresh feature branch.
2. `/speckit.clarify` — interactive 5-question pass that closes spec gaps.
3. `/speckit.plan` — produces `plan.md`, `research.md`, `data-model.md`, `contracts/`. The plan is checked against `.specify/memory/constitution.md`.
4. `/speckit.tasks` — emits dependency-ordered `tasks.md`.
5. `/speckit.analyze` — non-destructive cross-artefact consistency check.
6. `/speckit.implement` — executes tasks one by one against the codebase.

The constitution lives at `.specify/memory/constitution.md`. Amendments require a PR per its Governance section. The first worked example is `specs/murajaah-scheduler/spec.md`.

## No Silent Failures Policy

Every server action that writes to the DB or has side-effects MUST be loud: the user sees the outcome, the operator sees the error, and the audit trail records the attempt.

**Two mandatory primitives:**
- **`loudAction`** from `src/lib/actions/loud.ts` — wraps the handler so every throw is logged + (if critical) Telegram'd + audit_log'd. Returns `{ ok, message?, error? }`.
- **`<ActionFeedback state={...} />`** from `src/components/shared/action-feedback.tsx` — drop-in renderer that shows green/red banner from any `loudAction` result. Every form using `useActionState` MUST render it.

**Forbidden anti-patterns:**

```ts
// ❌ Silent fail: discarded error.
await supabase.from("teacher_profiles").insert({ ... } as never);

// ❌ Caught and swallowed.
try { await x.update(...); } catch { /* ignored */ }

// ❌ Form returns { error } but page doesn't render it.
const [state, formAction] = useActionState(myAction, null);
return <form action={formAction}>{/* no error display */}</form>;
```

**Required patterns:**

```ts
// ✅ Capture the error, return it to the caller.
const { error } = await supabase.from("teacher_profiles").insert({ ... } as never);
if (error) return { error: `فشل: ${error.message}` };

// ✅ Or wrap in loudAction for free logging + audit.
export const archiveTeacher = loudAction({
  name: "admin.archive-teacher",
  severity: "warning",
  audit: { table: "teacher_profiles", recordId: i => i.teacherId, action: "UPDATE" },
  handler: async ({ teacherId }) => {
    const { error } = await supabase.from("teacher_profiles").update(...).eq(...);
    if (error) throw error;
    return { message: "تم الأرشفة" };
  },
});

// ✅ Form renders ActionFeedback.
return <form action={formAction}><ActionFeedback state={state} />...</form>;
```

**Best-effort writes (audit_log, automation_logs)** — keep them non-blocking but pipe failures through `logError` so they're visible:

```ts
await supabase.from("audit_log").insert({...} as never)
  .catch(err => logError("audit insert failed", err, { tag: "audit" }));
```

**Migration plan**: existing 60+ silent-fail call sites are being migrated incrementally. New code MUST follow the patterns above. Reviewers should reject any PR introducing a new silent fail.

## Sentry ↔ Git commit convention

When a commit fixes a Sentry-reported issue, **include `Fixes JAVASCRIPT-NEXTJS-E4-<N>`** in the commit message body (or PR title/description). Sentry's GitHub integration auto-resolves the matching issue when the next release tagged on `main` contains the commit. Release tagging is owned by the `@sentry/nextjs` plugin (`withSentryConfig` in `next.config.ts`), which runs `release.setCommits.auto: true` during the Vercel build — no separate script involved.

Example:
```
fix(og): wrap blog OG image in try/catch + fallback + 24h cache

Fixes JAVASCRIPT-NEXTJS-E4-3
```

Find the short ID in the Sentry issue header (looks like `JAVASCRIPT-NEXTJS-E4-NN`). Keywords `Fixes`, `Resolves`, and `Closes` all work. The convention only kicks in once the commit lands on `main` and the next Vercel build ships — local commits don't trigger it.

## Database Migrations Policy

⚠️ **The Supabase Branching GitHub integration silently skips applies more than once a month** (incidents: 2026-04-26..27, 2026-05-01..02, 2026-05-03). Each time, the SQL never runs and the tracker never updates, but no error surfaces — you only find out when prod code SELECTs columns the schema doesn't have. **Do not trust the integration as the source of truth.**

The `.github/workflows/supabase-migrate.yml` workflow is now the source of truth. It runs `supabase db push --linked` on every push to `main` that touches `supabase/migrations/**`, and a dry-run on every PR. A failed push is a failed CI step that you can read, fix, and re-run. The Branching integration is left enabled as belt-and-suspenders but is no longer load-bearing.

**Required secret to make the workflow actually run:** `SUPABASE_DB_PASSWORD`. Without it, every run of `supabase-migrate.yml` fails fast with a pointer to the Supabase Dashboard → Project Settings → Database → Connection string. Set once with:

```bash
gh secret set SUPABASE_DB_PASSWORD
# paste the Postgres password at the prompt
```

If you see this workflow red on `main`, the secret is missing — the migrate is then quietly falling back to the Branching integration (the same vulnerability the workflow was meant to close). Check `gh secret list` first before debugging anything else.

### Going forward — new migrations

Use the helper script:

```bash
./scripts/new-migration.sh add_session_tags
# → creates supabase/migrations/<UTC timestamp>_add_session_tags.sql
```

Then edit the file with your DDL, commit, push to `main`. The `Supabase Migrate` GitHub Action runs `supabase db push --linked` and verifies the tracker. PRs get a dry-run preview that shows exactly what would apply.

New migrations are tracked in `supabase_migrations.schema_migrations` (Supabase's internal tracker) — **don't** add the `insert into public.schema_migrations` footer that the v* files use.

Optional local dry-run before push:
```bash
npx supabase db push --linked --dry-run
```

### Existing v* migrations

The 30+ files at `src/lib/supabase/migrations/v*.sql` all stay where they are — they're already applied to production via the project's own `public.schema_migrations` table. They're invisible to `supabase migration list --linked` (different naming, different location, different tracker). That's fine — don't try to migrate them across; the schema is already there.

### Manual / hotfix path (still works)

For migrations that need to bypass GitHub (e.g. a fix you want immediately), run any SQL file directly:

```bash
npx supabase db query --linked --file <path/to/file.sql>
```

This uses the Management API via your `supabase login` session. Bypasses both trackers, so use sparingly + remember to commit the file afterward so future readers see what changed.

### Detecting drift

- `npx supabase migration list --linked` shows **timestamped** files only (Local vs Remote columns). Use it to confirm a new migration applied.
- For the v* files, `select version from public.schema_migrations order by version` is the source of truth.
- CI runs `supabase db lint --linked` on every PR (`.github/workflows/supabase-lint.yml`) — catches syntax issues, does NOT catch un-applied migrations.

## Preview database isolation — known gap (P2)

All three Vercel environments (Production, Preview, Development) currently point at the same Supabase project (`xyqscjnqfeusgrhmwjts`). Preview deployments share `SUPABASE_SERVICE_ROLE_KEY` with Production, so any preview URL has full write access to the production database — RLS-bypassing inserts, updates, and deletes will all hit real rows.

**Until Supabase Branching is set up, treat every preview URL as production for the purposes of data-mutation testing.** Concrete don'ts on a preview deploy: do not test deletes, bulk updates, payment flows, role changes, cron-trigger curls, or anything that writes to `audit_log` unless you would do the same on `www.furqan.today`. Any CI job that runs against a preview sees real production data.

Detection is implicit — there's no environment guard in code that distinguishes Preview from Production. The only signal is the deployment URL itself. If a future migration or feature needs a sandbox, request a fresh Supabase project and a separate `*_PREVIEW` env var set, or wait for Branching (see Remaining Work).

Long-term fix: enable Supabase Branching for Preview so each PR auto-spins an ephemeral, isolated database that mirrors prod schema. Tracked in Remaining Work → Infrastructure improvements.

## Sentry — activating in production

The Sentry SDK is fully scaffolded (`@sentry/nextjs@10.49.0`, three config files at the repo root, `logError` routes through `Sentry.captureException` when DSN is set). Activation is a 5-minute task:

1. Create a free Sentry account at https://sentry.io/signup/ — pick the **Next.js** platform when prompted.
2. Sentry shows you a DSN that looks like `https://xxxx@oNNNN.ingest.sentry.io/PPPP`. Copy it.
3. In Vercel → furqan project → Settings → Environment Variables, add:
   - `SENTRY_DSN` = (the DSN, all environments)
   - `NEXT_PUBLIC_SENTRY_DSN` = (same value, all environments — used by client SDK)
4. Trigger a redeploy (push any commit, or click "Redeploy" on the latest Vercel deployment).
5. Verify by intentionally throwing in any server action — the error should appear in Sentry within ~30 seconds.

Until DSN is set, `logError` falls back to `console.error` in dev and Telegram alerts on `severity: 'critical'`. No-op behavior in production keeps the app running normally.

### Sentry GitHub auto-resolve — currently broken (follow-up)

Two PRs in a row (PR #78 closing E4-1E, PR #146 closing E4-1F/-1D/-1X/-1W/-17/-11) shipped `Fixes JAVASCRIPT-NEXTJS-E4-<N>` keywords in their commit messages and merged to `main` with a successful Vercel build, yet Sentry did NOT auto-resolve the referenced issues. Both PRs required manual closure. The keyword convention itself is sound (Sentry's docs list `Fixes`/`Resolves`/`Closes`); the wiring between commit → release → issue is not firing.

Likely causes to check, in order of probability:
1. `release.setCommits.auto: true` in `next.config.ts` requires the `@sentry/nextjs` plugin to receive a writable `GITHUB_TOKEN` at build time, AND the Sentry org's GitHub App integration must be installed on the repo. If either is missing, the release lands but with no commit list, so the keyword can't be parsed.
2. The Sentry GitHub integration might be installed at the user level (`drdeebtech`) rather than the org. Sentry-side: visit https://furqan-academy.sentry.io/settings/integrations/github/ and confirm the repo `drdeebtech/furqan` is listed.
3. The Sentry release's `commits` field on the dashboard would show empty for these releases — that's the diagnostic; if commits ARE shown but issues stay open, it's a parsing or permissions bug instead.

Until fixed, manually resolve via the Sentry MCP `update_issue` tool (status `resolvedInNextRelease` or `resolved`) on every PR that ships a `Fixes JAVASCRIPT-NEXTJS-...` keyword. Track this as a P1 ops item; the auto-close is the only thing keeping the issue queue from growing during high-fix-velocity sprints.

## Supabase Auth — leaked password protection

Supabase Auth can reject passwords known to be in the HaveIBeenPwned breach corpus. This is **off by default** and cannot be migrated — it's a dashboard toggle. Enable once per environment:

1. Supabase Dashboard → **Authentication** → **Providers** → **Email** (or the project's auth settings page).
2. Find **Leaked password protection** (sometimes labeled "HaveIBeenPwned check").
3. Toggle on. Save.
4. Verify by attempting to register / reset with a known-pwned password (e.g. `password123`) — the request must be rejected.
5. Verify via Dashboard → Advisors — the `auth_leaked_password_protection` finding should be gone. (Do **not** use `mcp__claude_ai_Supabase__*` here — see Supabase MCP gotcha below.)

Docs: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Supabase MCP — wrong-account gotcha

The `mcp__claude_ai_Supabase__*` tools (and the `supabase` CLI when logged in via the host machine) are authenticated to the user's *primary* Supabase account, which is **not** the account that owns the FURQAN database. FURQAN's project lives under a separate account (`alforqan.egy@gmail.com`); MCP only sees `Dr Deeb Urology Clinic`.

**Consequences:**
- `list_projects`, `get_advisors`, `execute_sql`, `get_logs`, `apply_migration` and friends silently target the **wrong project** if called blindly. They will return data for the urology clinic schema, not FURQAN.
- The CLAUDE.md instruction to "Re-run `get_advisors`" only works if FURQAN's account is added to MCP/CLI auth. Until that's wired up, treat all Supabase verification steps as "browser only".

**For audits / advisors / one-off SQL on FURQAN**: open the dashboard at https://supabase.com/dashboard signed in as `alforqan.egy@gmail.com`. For programmatic access, generate a personal access token under that account and use the `supabase` CLI with `--token`, or set `SUPABASE_ACCESS_TOKEN` in a shell-scoped env var.

## Verification Checklist
After any code change:
1. `npx next build` — must pass with zero errors
2. `npm run lint` — no new errors
3. `npx playwright test` — all existing tests pass
4. `npx vercel ls furqan --prod` — verify deployment succeeds

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **furqan** (9435 symbols, 15865 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/furqan/context` | Codebase overview, check index freshness |
| `gitnexus://repo/furqan/clusters` | All functional areas |
| `gitnexus://repo/furqan/processes` | All execution flows |
| `gitnexus://repo/furqan/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Agent skills

### Issue tracker

Issues live as GitHub issues at `github.com/drdeebtech/furqan/issues`, accessed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. The first four don't exist on the repo yet — the `triage` skill creates them on first use; `wontfix` already exists. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. `CONTEXT.md` and `docs/adr/` at the repo root (both empty for now; `/grill-with-docs` populates them lazily as terms and decisions resolve). See `docs/agents/domain.md`.
