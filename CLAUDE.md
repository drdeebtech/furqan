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
- **Node version**: 20.x (set in `.nvmrc`, do NOT use 24.x)
- After pushing, verify deployment status: `npx vercel ls furqan --prod`
- If deployment is "Blocked", check git author email matches `drdeebtech@gmail.com`
- The `vercel.json` has `installCommand: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install"` — do not remove this
- Edge functions in `supabase/functions/` are excluded from `tsconfig.json` (Deno imports)

# Project Overview

FURQAN Academy — Online Quran teaching platform (V12)

**Current phase:** Platform hardening & operational leverage (post-audit)
**Audit report:** `AUDIT.md` — full platform audit with grades and recommendations
**Implementation roadmap:** `ROADMAP.md` — 8 sprints from P1 to P4

## Stack
- **Next.js 16.2.2** (App Router, Turbopack) · **React 19** · **TypeScript 5**
- **Supabase** (PostgreSQL 17, Auth, RLS, Realtime) · **@supabase/ssr**
- **Daily.co** (Video sessions + observer mode)
- **Stripe** (Payments — schema ready, checkout flow deferred until API keys provided)
- **TailwindCSS 4** · **next-intl** (i18n, Arabic/English)
- **n8n** (n8n.drdeeb.tech — automation engine, 52 workflows planned)
- **Deployed on Vercel** (Hobby plan, furqan.today)

## Roles (4)
- **student** — browse teachers, book sessions, join video, track progress, homework, packages, messages
- **teacher** — manage availability, confirm bookings, conduct sessions, assign/grade homework, CV workflow, evaluations, messages
- **admin** — full platform management: users, teachers, bookings, sessions, evaluations, packages, services, blog, payments, notifications, automation, settings
- **moderator** — users (students+teachers only), CV review, session observation, evaluations, audit log (read-only)

## Domain Ownership Model

Each domain owns its events, validation rules, and downstream triggers:

| Domain | Source of Truth | Key Tables | Owner Actions |
|--------|----------------|------------|---------------|
| **Booking** | `bookings` table | bookings, teacher_availability, availability_exceptions | createBooking, updateBookingStatus |
| **Session** | `sessions` table | sessions, session_observers | endSession, markNoShow, savePostSessionNotes |
| **Homework** | `homework_assignments` table | homework_assignments | createHomework, markStudentReady, gradeHomework |
| **Progress** | `student_progress` + `session_evaluations` | student_progress, recitation_errors, session_evaluations | createEvaluation, createTeacherEvaluation |
| **Package** | `packages` + `student_packages` | packages, student_packages, payments, invoices | deduct_package_session(), Stripe webhook |
| **Communication** | `notifications` + `parent_reports` | notifications, parent_reports, messages, conversations | sendMessage, markAsRead, parent notifications |
| **Automation** | `automation_logs` | automation_logs, platform_settings | emitEvent(), n8n webhook callback |

## Key Architecture
- **Route protection**: `src/proxy.ts` — role-based middleware, admin can access `/moderator/*`
- **Server actions**: `"use server"` pattern with `revalidatePath`, `as never` casts for Supabase
- **Admin client**: `src/lib/supabase/admin.ts` — service-role client for user creation
- **Feature flags**: `src/lib/settings.ts` + `platform_settings` table
- **Parent notifications**: `src/lib/notifications/parent.ts` — report system for parents
- **Session observation**: Daily.co observer tokens with mic/camera off, max_participants bumped to 3
- **Homework system**: `src/lib/actions/homework.ts` — 5 server actions with state machine and auto-regeneration
- **Event emission**: `src/lib/automation/emit.ts` — non-blocking webhooks to n8n with per-event routing
- **n8n callback**: `src/app/api/webhooks/n8n/route.ts` — log, notify, idempotency check
- **n8n instance**: n8n.drdeeb.tech — **26 active FURQAN workflows** deployed across 9 areas
- **Notification bell**: `src/components/shared/notification-bell.tsx` — topbar dropdown with unread count
- **Notification dispatcher**: `src/lib/notifications/dispatcher.ts` — multi-channel with preferences, delivery logging
- **Admin control tower**: `/admin/control-tower` — 7 real-time operational widgets
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

## Enums (23 total)
Postgres ENUMs: user_role, gender_type, booking_status, session_type, payment_status, msg_type, notif_type, student_level, cv_status, evaluation_type, report_type, homework_type, homework_status
Text CHECK: package_type, student_package_status, automation_log_status, conversation_status, credit_source, progress_type, recitation_error_type, transaction_type, session_created_via, audit_action, recitation_standard

## SQL Functions
- `is_admin()`, `is_moderator()`, `is_admin_or_mod()`
- `deduct_package_session(uuid)` — atomic session deduction
- `set_updated_at()` — trigger function
- `sync_conv_ts()` — auto-update conversation timestamps

## Events Emitted (to n8n)
booking.created, booking.confirmed, booking.cancelled, session.ended, session.no_show, session.notes_saved, homework.assigned, homework.student_ready, homework.graded

## Coding Patterns
- All server actions use `"use server"` directive
- Use `as never` for Supabase `.insert()` / `.update()` calls
- Use `.returns<Type[]>()` for queries on V10+ tables
- Use `useActionState` from `"react"` (NOT from `"react-dom"`)
- Use `startTransition` for setState inside useEffect (React compiler compliance)
- All user-facing text in Arabic, bilingual labels optional (Arabic + English hint)
- `revalidatePath()` after every mutation
- Audit logging for admin destructive actions
- Notifications are non-blocking (`try/catch` with empty catch)
- **NEW:** All event-emitting server actions must call `emitEvent()` from `src/lib/automation/emit.ts`

## File Structure (key paths)
```
src/
├── app/
│   ├── (auth)/          — login, register, forgot-password
│   ├── (public)/        — landing, about, contact, packages, services, teachers, blog
│   ├── admin/           — 33+ pages: users, teachers, bookings, sessions, evaluations, packages, services, blog, payments, notifications, automation, settings
│   ├── moderator/       — 10 pages: users, cv-review, sessions, evaluations, audit
│   ├── student/         — 12+ pages: dashboard, teachers, bookings, sessions, homework, packages, progress, notifications, messages, notes
│   ├── teacher/         — 11+ pages: dashboard, sessions, availability, students, homework, cv, evaluations, notifications, messages
│   └── api/             — stripe webhook, bookings, n8n webhook
├── components/
│   ├── shared/ (20+)    — nav, topbar, notification-bell, stat-card, widget-card, data-table, analytics-chart, breakdown-bar, live-sessions-widget, messages-view, pwa-install-prompt, etc.
│   ├── public/ (9)      — public-nav, public-footer, testimonials, register-banner, whatsapp-button
│   └── seo/ (1)         — structured-data
├── lib/
│   ├── supabase/        — client.ts, server.ts, middleware.ts, admin.ts, helpers.ts, migrations/
│   ├── actions/         — evaluations.ts, homework.ts, notifications.ts
│   ├── automation/      — emit.ts (event emission to n8n)
│   ├── notifications/   — parent.ts
│   ├── stripe/          — .gitkeep (Stripe integration deferred)
│   ├── i18n/            — context.tsx, lang-toggle.tsx
│   ├── theme/           — context.tsx, theme-toggle.tsx
│   ├── daily.ts, email.ts, whatsapp.ts, settings.ts, constants.ts, dashboard-queries.ts, cn.ts
│   └── feature-flags-context.tsx
├── types/
│   └── database.ts      — 30 table interfaces, 23 enums
└── proxy.ts             — middleware route protection
automation/
├── BLUEPRINT.md         — 52-workflow master plan (12 areas)
├── VPS_HANDOFF.md       — Context file for Claude Code on VPS
└── VPS_ANSWERS.md       — Setup answers and credentials checklist
supabase/functions/      — 4 edge functions (auto-reminder, auto-complete, no-show-detector, weekly-report)
```

## Completed Features (Phases A–I)
- 4 role dashboards with real Supabase data + shared widget system
- Bilingual RTL/LTR with Arabic/English toggle + dark/light mode
- Database schema V9→V12 (sessions, evaluations, homework, packages, automation)
- Blog CMS, SEO, RLS policies, n8n instance
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

## Audit Status
Full platform audit completed: `AUDIT.md`
- Product Architecture: **A-**
- Data Model: **A-**
- UX Direction: **B+**
- Operational Readiness: **B**
- Automation Maturity: **B-**
- Revenue/Payment Readiness: **C+** (Stripe deferred)
- Scale Readiness: **B-**

**Top recommendation:** Platform hardening > new features. See ROADMAP.md.

## Priority Roadmap (Audit-Driven)

### P1 — Critical (Do First)
1. **Stripe payment completion** — checkout, webhook, fulfillment, invoices (blocked on API keys)
2. **Communication infrastructure** — message_delivery_log, communication_preferences, dispatcher
3. **Webhook security** — sign all internal webhooks
4. **Event catalog + lifecycle docs** — EVENT_CATALOG.md, LIFECYCLES.md
5. **n8n first 8 workflows** — health check, reminders, no-show, parent reports, package alerts

### P2 — High Value (Next)
6. **Dashboard UX hardening** — action-oriented by role
7. **Retention engine** — retention_signals table, churn scoring, trial-to-paid
8. **Teacher compliance** — grading follow-up, evaluation reminders, health metrics
9. **Parent report automation** — AI + structured fallback via n8n

### P3 — Operational Leverage
10. **Admin control tower** — exception queues, anomaly monitoring
11. **Teacher performance intelligence** — weekly snapshots, ranking
12. **Package renewal campaigns** — exhaustion/expiry flows

### P4 — Advanced/AI
13. **AI parent narratives** at scale
14. **AI curriculum advisor**
15. **Teacher matching**
16. **Parent self-service chatbot**
17. **Recording transcription**

## Verification Checklist
After any code change:
1. `npx next build` — must pass with zero errors
2. `npm run lint` — no new errors
3. `npx playwright test` — all existing tests pass
4. `npx vercel ls furqan --prod` — verify deployment succeeds
