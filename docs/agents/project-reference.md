# Project Reference — FURQAN

> Extracted from `CLAUDE.md` on 2026-05-12 to keep `CLAUDE.md` under the 40k
> auto-context budget. This file holds the descriptive snapshot of the project
> (stack, roles, schema overview, n8n registry, file map, feature history,
> remaining work, docs index). Active rules and gotchas remain in `CLAUDE.md`.

FURQAN Academy — Online Quran teaching platform (V13/V17).

**Current phase:** Platform hardening & operational leverage (post-audit)
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

**`session.ended` sources**: `source:"furqan-app"` (teacher manual end via `endSession`) OR `source:"daily-webhook"` (Daily.co `meeting.ended` via `/api/webhooks/daily`). n8n workflows MUST check `source` to avoid double-firing side effects on reconcile. `is_reconcile:true` in the payload indicates Daily arrived after manual end.

**`session.no_show` sources**: `source:"daily-webhook"` only (misclick filter — `meeting.ended` with `duration < 5min`). Payload includes `reason:"misclick-filter"` and `duration_seconds`.

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
| `CLAUDE.md` | AI assistant instructions — load-bearing rules only |
| `.impeccable.md` | **Design Context — read before any UI work.** Brand personality, references/anti-references, principles, tokens, components. |
| `.github/copilot-instructions.md` | Synced summary of `.impeccable.md` for Copilot/Vercel Agent surfaces |
| `PROJECT.md` | Full technical reference (563 lines) |
| `ROADMAP.md` | Implementation roadmap — 8 sprints (404 lines) |
| `EVENT_CATALOG.md` | Event taxonomy — 9 active + 13 planned |
| `LIFECYCLES.md` | 7 state machine diagrams |
| `automation/BLUEPRINT.md` | 52-workflow master plan |
| `automation/VPS_HANDOFF.md` | n8n VPS session context |
| `docs/agents/env-vars.md` | Environment variables source of truth |
| `docs/agents/project-reference.md` | This file — project reference snapshot |
| `docs/runbooks/sentry-activation.md` | One-time Sentry DSN setup |
| `docs/runbooks/supabase-leaked-password.md` | One-time HIBP toggle |
| `.specify/memory/constitution.md` | Five-principle constitution checked by `/speckit.plan` and `/speckit.analyze` |
| `specs/<feature>/spec.md` | Per-feature spec produced by `/speckit.specify`; one folder per net-new feature |
