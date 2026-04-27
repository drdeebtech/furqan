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
- **Node version**: 20.x (set in `.nvmrc` and `package.json` `engines`). Vercel platform default is now Node 24 LTS — the live project setting also reads `24.x`, but `.nvmrc` wins on the build runner so prod actually runs Node 20. If you intentionally upgrade, change `.nvmrc`, `engines.node`, and the Vercel project setting together.
- After pushing, verify deployment status: `npx vercel ls furqan --prod`
- If deployment is "Blocked", check git author email matches `drdeebtech@gmail.com`
- The `vercel.json` has `installCommand: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install"` — do not remove this
- Edge functions in `supabase/functions/` are excluded from `tsconfig.json` (Deno imports)

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

## Roles (4)
- **student** — browse teachers, book sessions, join video, track progress, homework, packages, messages
- **teacher** — manage availability, confirm bookings, conduct sessions, assign/grade homework, CV workflow, evaluations, messages
- **admin** — full platform management: users, teachers, bookings, sessions, evaluations, packages, services, blog, payments, notifications, automation, n8n control, settings
- **moderator** — users (students+teachers only), CV review, session observation, evaluations, audit log (read-only)

## Domain Ownership Model

| Domain | Source of Truth | Key Tables | Owner Actions |
|--------|----------------|------------|---------------|
| **Booking** | `bookings` table | bookings, teacher_availability, availability_exceptions | createBooking, updateBookingStatus |
| **Session** | `sessions` table | sessions, session_observers | endSession, markNoShow, savePostSessionNotes |
| **Homework** | `homework_assignments` table | homework_assignments | createHomework, markStudentReady, gradeHomework |
| **Progress** | `student_progress` + `session_evaluations` | student_progress, recitation_errors, session_evaluations | createEvaluation, createTeacherEvaluation |
| **Package** | `packages` + `student_packages` | packages, student_packages, payments, invoices | deduct_package_session(), Stripe webhook |
| **Communication** | `notifications` + `parent_reports` | notifications, parent_reports, messages, conversations, message_delivery_log, communication_preferences | dispatchNotification(), notify(), parent notifications |
| **Automation** | `automation_logs` | automation_logs, platform_settings, retention_signals | emitEvent(), n8n webhook callback |

## Key Architecture
- **Route protection**: `src/proxy.ts` — role-based middleware, admin can access `/moderator/*`
- **Server actions**: `"use server"` pattern with `revalidatePath`, `as never` casts for Supabase
- **Admin client**: `src/lib/supabase/admin.ts` — service-role client for user creation
- **Feature flags**: `src/lib/settings.ts` + `platform_settings` table
- **Parent notifications**: `src/lib/notifications/parent.ts` — report system for parents
- **Notification dispatcher**: `src/lib/notifications/dispatcher.ts` — multi-channel with preferences, quiet hours, delivery logging to message_delivery_log
- **Session observation**: Daily.co observer tokens with mic/camera off, max_participants bumped to 3
- **Homework system**: `src/lib/actions/homework.ts` — 5 server actions with state machine and auto-regeneration
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

## Database (33 tables)
Original 20 tables + 5 V9 tables + 2 V10 tables + 2 V11 tables + 1 V12 table + 3 V13 tables.

V9: platform_settings, session_evaluations, parent_reports, session_notes_history, session_observers
V10: services, homework_assignments
V11: packages, student_packages
V12: automation_logs
V13: message_delivery_log, communication_preferences, retention_signals

Migration files: v9_001, v10_001, v10_002, v11_001, v12_001, v13_001, v13_002

## Enums (26 total)
Postgres ENUMs: user_role, gender_type, booking_status, session_type, payment_status, msg_type, notif_type, student_level, cv_status, evaluation_type, report_type, homework_type, homework_status
Text CHECK: package_type, student_package_status, automation_log_status, delivery_channel, delivery_status, preferred_language, conversation_status, credit_source, progress_type, recitation_error_type, transaction_type, session_created_via, audit_action, recitation_standard

## SQL Functions
- `is_admin()`, `is_moderator()`, `is_admin_or_mod()`
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
│   ├── admin/           — 35+ pages: users, teachers, bookings, sessions, evaluations, packages, services, blog, payments, notifications, automation, n8n, control-tower, settings
│   ├── moderator/       — 10 pages: users, cv-review, sessions, evaluations, audit
│   ├── student/         — 12+ pages: dashboard, teachers, bookings, sessions, homework, packages, progress, notifications, messages, notes
│   ├── teacher/         — 11+ pages: dashboard, sessions, availability, students, homework, cv, evaluations, notifications, messages
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
- 4 role dashboards with real Supabase data + shared widget system
- Bilingual RTL/LTR with Arabic/English toggle + dark/light mode (Liquid Glass Design System v3)
- Database schema V9→V13 (sessions, evaluations, homework, packages, automation, communication, retention)
- Blog CMS, SEO, RLS policies
- CV review workflow for moderators
- Basic booking + sessions with Daily.co video
- **Homework system** (V10) — state machine, 6 types, grading, auto-regeneration
- **Package & pricing** (V11) — DB-driven packages, admin CRUD, 5 seed packages, student view
- **In-app notifications** — bell + dropdown + full pages + mark-read/delete
- **Student progress** — juz tracker, eval chart, milestones, homework performance
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

## Documentation Files
| File | Purpose |
|------|---------|
| `CLAUDE.md` | This file — AI assistant instructions |
| `PROJECT.md` | Full technical reference (563 lines) |
| `AUDIT.md` | Platform audit report (433 lines) |
| `ROADMAP.md` | Implementation roadmap — 8 sprints (404 lines) |
| `EVENT_CATALOG.md` | Event taxonomy — 9 active + 13 planned |
| `LIFECYCLES.md` | 7 state machine diagrams |
| `automation/BLUEPRINT.md` | 52-workflow master plan |
| `automation/VPS_HANDOFF.md` | n8n VPS session context |

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

## Database Migrations Policy

The project uses a **custom `schema_migrations` table** (not Supabase CLI's tracking). Every SQL file under `src/lib/supabase/migrations/` MUST end with:

```sql
insert into schema_migrations (version, description)
  values ('vXX_YYY', 'Short description')
  on conflict do nothing;
```

**Applying migrations to production (preferred — auto-deploy):**

As of 2026-04-26 the Supabase Branching GitHub integration is wired up:
- Repo: `drdeebtech/furqan` · Working directory: `src/lib` · Production branch: `main`
- "Deploy to production on push" is ON. "Automatic branching" stays OFF (Pro-only).
- "Supabase changes only" is ON, so deploys only trigger when files under `src/lib/supabase/` change.

When a PR touching `src/lib/supabase/migrations/*.sql` merges to `main`, Supabase auto-applies the new files in version order. The migrations end with `on conflict do nothing` on `schema_migrations`, so this is idempotent — running locally + auto-deploy wouldn't double-write.

**Applying migrations to production (fallback — manual):**
If the auto-deploy fails (visible in Supabase dashboard → Branching → Merge requests), or for hotfixes that bypass GitHub:
1. Open Supabase Dashboard → SQL Editor → paste the migration file → Run.
2. The `schema_migrations` row commits in the same transaction; running twice is a no-op.
3. The version recorded in `schema_migrations` should match `vXX_YYY` from the filename.

**Detecting drift:** the `bio_en` (`v14_006`) migration silently never ran in production until 2026-04-26. To prevent recurrence:
- Before merging schema changes, manually verify in `/admin/settings` that the prior version appears in the Migrations panel.
- After applying any migration, sanity-check via `supabase migration list --linked` (note: this lists CLI-tracked migrations only — our custom table is the source of truth).
- CI runs `supabase db lint --linked` on every PR (`.github/workflows/supabase-lint.yml`) — catches syntax issues but does NOT catch un-applied migrations.

**Future improvement** (not yet wired): add a CI step that `psql`s production and diffs `select version from schema_migrations` against the file list under `src/lib/supabase/migrations/`. Fails the build on mismatch.

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

## Verification Checklist
After any code change:
1. `npx next build` — must pass with zero errors
2. `npm run lint` — no new errors
3. `npx playwright test` — all existing tests pass
4. `npx vercel ls furqan --prod` — verify deployment succeeds

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **furqan** (2618 symbols, 6079 relationships, 196 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/furqan/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/furqan/context` | Codebase overview, check index freshness |
| `gitnexus://repo/furqan/clusters` | All functional areas |
| `gitnexus://repo/furqan/processes` | All execution flows |
| `gitnexus://repo/furqan/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

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
