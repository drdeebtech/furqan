# FURQAN Academy — Ultimate Project Documentation

> Online Quran teaching platform — V11 | furqan.today
> Last updated: 2026-04-09

---

## 1. Overview

FURQAN Academy is a full-stack online Quran teaching platform connecting students with certified teachers for live video sessions. The platform supports Arabic-first RTL design, 4 user roles, structured homework with grading, package-based pricing, in-app notifications, and Progressive Web App capabilities.

**Live URL:** https://furqan.today
**Repository:** github.com/drdeebtech/furqan (private)
**Platform:** Vercel Hobby plan
**n8n Instance:** n8n.drdeeb.tech

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Framework** | Next.js (App Router, Turbopack) | 16.2.2 |
| **UI** | React | 19.2.4 |
| **Language** | TypeScript (strict) | 5 |
| **Styling** | TailwindCSS 4 + Liquid Glass Design System | 4 |
| **Database** | Supabase (PostgreSQL 17 + Auth + RLS + Realtime) | 2.101.1 |
| **Auth** | @supabase/ssr (cookie-based) | 0.10.0 |
| **Video** | Daily.co | 0.89.1 |
| **Payments** | Stripe | 22.0.0 |
| **Email** | Resend | 6.10.0 |
| **i18n** | next-intl + custom useLang() | 4.9.0 |
| **Forms** | React Hook Form + Zod 4 | 7.72.1 / 4.3.6 |
| **Charts** | Recharts | 3.8.1 |
| **Icons** | Lucide React | 1.7.0 |
| **Testing** | Playwright | 1.59.1 |
| **Deployment** | Vercel (Hobby plan) | — |
| **Node** | 20.x (.nvmrc enforced) | 20 |

---

## 3. Roles & Permissions

| Role | Access | Key Capabilities |
|------|--------|-----------------|
| **student** | `/student/*` | Browse teachers, book sessions, join video, track progress, view homework, manage packages, messaging |
| **teacher** | `/teacher/*` | Manage availability, confirm bookings, conduct sessions, assign/grade homework, CV workflow, evaluations, messaging |
| **admin** | `/admin/*` + `/moderator/*` | Full platform management: users, teachers, bookings, sessions, evaluations, packages, services, blog, payments, settings, notifications |
| **moderator** | `/moderator/*` | Users (students+teachers), CV review, session observation, evaluations, audit log (read-only) |

**Route protection:** `src/proxy.ts` — middleware-based, admin can access moderator routes.

---

## 4. Database Schema (29 Tables)

### Core Tables (Original 20)

| # | Table | Purpose | Key Fields |
|---|-------|---------|-----------|
| 1 | `profiles` | User accounts | role, full_name, phone, timezone, lang, parent_name/email/phone |
| 2 | `teacher_profiles` | Teacher-specific data | bio, specialties, cv_status, hourly_rate, rating_avg, is_accepting |
| 3 | `teacher_ijaza` | Recitation chain credentials | riwaya, chain_text, granted_by, verified_by |
| 4 | `refund_policies` | Hours-based refund rules | hours_before_min/max, refund_percentage |
| 5 | `payments` | Stripe payment records | stripe_payment_intent, amount_usd, status, tax fields |
| 6 | `payment_transactions` | Payment ledger | type (charge/refund/adjustment), amount_usd |
| 7 | `student_credits` | Session credit pools | total, used, expires_at, source (purchase/refund/gift/admin) |
| 8 | `teacher_availability` | Weekly recurring slots | day_of_week, start_time, end_time, slot_duration |
| 9 | `availability_exceptions` | Date-based blocks | date, is_blocked, reason |
| 10 | `bookings` | Session reservations | student_id, teacher_id, status, scheduled_at, duration_min, student_package_id |
| 11 | `sessions` | Video call records | booking_id, room_url, started_at, ended_at, post_session_notes, homework |
| 12 | `conversations` | Messaging channels | student_id, teacher_id, status, last_message_at |
| 13 | `messages` | Individual messages | conversation_id, sender_id, content, msg_type, is_read |
| 14 | `student_progress` | Surah/ayah tracking | progress_type, surah_from/to, quality_rating, level |
| 15 | `recitation_errors` | Error documentation | error_type, surah_num, ayah_num, resolved |
| 16 | `reviews` | Student ratings | rating, comment, teacher_reply |
| 17 | `notifications` | Multi-channel alerts | type, title, body, channel[], is_read |
| 18 | `invoices` | Payment receipts | invoice_number, amount_usd, pdf_url |
| 19 | `audit_log` | Change tracking | table_name, action, old_data, new_data |
| 20 | `schema_migrations` | Version control | version, description |

### V9 Tables (5)

| # | Table | Purpose |
|---|-------|---------|
| 21 | `platform_settings` | Key-value feature flags (hide_reviews, hide_prices) |
| 22 | `session_evaluations` | Student assessment scores (hifz, tajweed, akhlaq, attendance, overall /10) |
| 23 | `parent_reports` | Parent notification reports (session_summary, evaluation, missed_session) |
| 24 | `session_notes_history` | Notes edit audit trail |
| 25 | `session_observers` | Admin/moderator observation tracking |

### V10 Tables (2)

| # | Table | Purpose |
|---|-------|---------|
| 26 | `services` | Dynamic service definitions (bilingual, features array) |
| 27 | `homework_assignments` | Structured homework with state machine, grading, auto-regeneration |

### V11 Tables (2)

| # | Table | Purpose |
|---|-------|---------|
| 28 | `packages` | Package definitions (5 types, 4 currencies, features, admin CRUD) |
| 29 | `student_packages` | Student purchased packages (sessions_total/used, status, expires_at) |

### Enums

**Postgres ENUM types (11):**
- `user_role`: student | teacher | admin | moderator
- `gender_type`: male | female
- `booking_status`: pending | confirmed | completed | cancelled | no_show
- `session_type`: hifz | muraja | tajweed | tilawa | qiraat | tafsir | combined | other
- `payment_status`: pending | succeeded | failed | refunded
- `msg_type`: text | audio | file
- `notif_type`: booking | payment | message | reminder | system | homework
- `student_level`: beginner | intermediate | advanced
- `cv_status`: draft | pending_review | approved | rejected
- `evaluation_type`: weekly | biweekly | monthly | quarterly
- `report_type`: session_summary | evaluation | custom | missed_session | schedule_change

**V10 Postgres ENUM types (2):**
- `homework_type`: hifz | muraja | recitation | tajweed | writing | listening
- `homework_status`: assigned | student_ready | completed_excellent | completed_good | completed_needs_work | completed_not_done

**V11 Text CHECK types (2):**
- `package_type`: single_session | pack_4 | pack_8 | pack_12 | full_course
- `student_package_status`: active | expired | cancelled

**Text CHECK unions (8):**
- `conversation_status`, `credit_source`, `progress_type`, `recitation_error_type`, `transaction_type`, `session_created_via`, `audit_action`, `recitation_standard`

### SQL Functions

| Function | Purpose |
|----------|---------|
| `is_admin()` | Check if user is admin |
| `is_moderator()` | Check if user is moderator |
| `is_admin_or_mod()` | Check if user is admin or moderator |
| `deduct_package_session(uuid)` | Atomic session deduction (prevents race conditions) |
| `set_updated_at()` | Trigger function for updated_at timestamps |
| `sync_conv_ts()` | Auto-update conversation.last_message_at on message insert |

### Migration Files

```
src/lib/supabase/migrations/
├── v9_001_schema.sql       — Moderator role, CV workflow, evaluations, observations, feature flags
├── v10_001_services.sql    — Dynamic services table
├── v10_002_homework.sql    — Homework assignments with state machine
└── v11_001_packages.sql    — Packages & pricing system
```

---

## 5. Completed Features

### Phase A: Homework System (V10)
- 6 homework types: hifz, muraja, recitation, tajweed, writing, listening
- State machine: assigned -> student_ready -> completed_excellent | good | needs_work | not_done
- "I'm Ready" button (student confirms readiness before next session)
- Teacher grades with 4 outcomes in post-session form
- Auto-regeneration: needs_work/not_done auto-creates new homework via parent_assignment_id
- Edit window: teacher can edit until next session starts
- 4 notification flows: assigned, ready, graded, parent report for not_done
- Dashboard widgets: BreakdownBar with real homework data
- Pages: `/student/homework`, `/teacher/homework`

### Phase B: Package & Pricing System (V11)
- 5 package types: single_session ($8), pack_4/Starter ($40), pack_8/Standard ($50), pack_12/Premium ($65), full_course ($180)
- 4 currencies: USD, GBP, SAR, AUD
- Admin CRUD: `/admin/packages` (create, edit, toggle active, delete)
- Public page: `/packages` fetches from DB with currency switcher
- Student page: `/student/packages` with progress bars (sessions_used/total)
- Dashboard widget showing remaining sessions
- Atomic session deduction function (prevents race conditions)
- Stripe integration deferred until API keys ready

### Phase C: In-App Notifications
- NotificationBell component in topbar with unread count badge + dropdown
- 6 notification types with icons/colors: booking, payment, message, reminder, system, homework
- Server actions: fetchNotifications, markAsRead, markAllAsRead, deleteNotification
- Full pages: `/student/notifications`, `/teacher/notifications`
- Role-aware "View All" link

### Phase D: Student Progress & Reports
- Stats grid: completed sessions, study hours, juz studied, current level
- 30-Juz tracker: visual grid highlighting studied juz from student_progress records
- Evaluation chart: bar visualization of hifz/tajweed/overall scores over time
- Latest evaluation summary with strengths/recommendations
- Homework performance breakdown (excellent/good/needs_work/not_done)
- Milestone badges: 1, 10, 25, 50, 100 sessions
- Progress log with surah ranges, quality ratings, type badges

### Phase E: Teacher Onboarding Polish
- 5-step onboarding checklist: profile, CV, admin review, availability, first student
- Visual progress bar with percentage
- Status icons: done (green check), pending (blue pulse), error (red), todo (gray)
- CV link added to teacher sidebar nav

### Phase F: Student Discovery
- Teacher browse with search by name
- Specialty filter (hifz, tajweed, muraja, tilawa, qiraat, tafsir)
- Gender filter (all, male, female)
- Sort controls: top rated, most experienced, lowest price
- Teacher cards with avatar, rating stars, bio, specialties, book button

### Phase G: Communication Enhancements
- markConversationAsRead: marks incoming messages as read when conversation opened
- getUnreadMessageCount: counts unread messages across all conversations
- Message notifications: sends in-app notification to recipient with message preview

### Phase H: Progressive Web App (PWA)
- Service worker: cache-first for static assets, network-first for pages
- Viewport export with responsive theme-color (dark/light)
- Apple Web App meta tags (capable, status-bar-style, title)
- PWA install prompt banner with session-persistent dismiss

### Previously Completed (Pre-Phase A)
- 4 role dashboards with real Supabase data
- Shared widget system (StatCard, AnalyticsChart, DataTable, LiveSessions, BreakdownBar, WidgetCard)
- Bilingual RTL/LTR with Arabic/English toggle
- Dark + light mode (Liquid Glass Design System)
- Blog CMS with 6 seeded articles
- SEO (sitemap, robots, structured data, OG images)
- RLS policies audited
- n8n instance with 2 workflows
- CV review workflow for moderators
- Basic booking + sessions with Daily.co video
- Stripe payment integration (basic schema)

---

## 6. Architecture & Patterns

### Server Actions Pattern
```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function doSomething(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "غير مصرح" };
  
  const { error } = await supabase.from("table").insert({...} as never);
  if (error) return { error: "فشل العملية" };
  
  try { /* non-blocking notifications */ } catch { /* silent */ }
  
  revalidatePath("/path");
  return { success: true };
}
```

### Key Patterns
- `as never` for Supabase `.insert()` / `.update()` (type workaround)
- `.returns<Type[]>()` for new tables (TypeScript resolution)
- `useActionState` from `"react"` (NOT `"react-dom"`)
- All user-facing text in Arabic, bilingual labels optional
- `revalidatePath()` after every mutation
- Notifications are non-blocking (`try/catch` with empty catch)
- Audit logging for admin destructive actions
- `startTransition` for setState in effects (React compiler compliance)

### Supabase Client Types
| Client | File | Usage |
|--------|------|-------|
| Server | `src/lib/supabase/server.ts` | Server Components + Server Actions (cookie-based auth) |
| Browser | `src/lib/supabase/client.ts` | Client Components (auto-refresh tokens) |
| Admin | `src/lib/supabase/admin.ts` | Service-role (bypasses RLS) for user creation, webhooks |

### Data Flow
```
Server Component (page.tsx)
  → Fetches data from Supabase
  → Passes as props to Client Component
  
Client Component
  → Renders UI with useLang() for i18n
  → Form submissions via useActionState or onClick → server action
  → Server action mutates DB → revalidatePath()
  → Page re-renders with fresh data
```

---

## 7. File Structure

```
furqan/
├── public/
│   ├── manifest.json          — PWA manifest (RTL, Arabic, standalone)
│   ├── sw.js                  — Service worker
│   ├── favicon-16.png, favicon-32.png
│   ├── apple-touch-icon.png
│   ├── logo-192.png, logo-512.png
│   └── og-default.png
├── src/
│   ├── app/
│   │   ├── layout.tsx         — Root layout (fonts, viewport, PWA, theme)
│   │   ├── globals.css        — Tailwind + CSS variables + Liquid Glass
│   │   ├── (auth)/            — login, register, forgot-password
│   │   ├── (public)/          — landing, about, contact, packages, services, teachers, blog
│   │   ├── admin/             — 33 pages: users, teachers, bookings, sessions, evaluations, packages, services, blog, payments, notifications, settings
│   │   ├── moderator/         — 10 pages: users, cv-review, sessions, evaluations, audit
│   │   ├── student/           — 12 pages: dashboard, teachers, bookings, sessions, homework, packages, progress, notifications, messages, notes
│   │   ├── teacher/           — 11 pages: dashboard, sessions, availability, students, homework, cv, evaluations, notifications, messages
│   │   └── api/               — stripe webhook, bookings, auth
│   ├── components/
│   │   ├── shared/ (20)       — dashboard-layout, nav, topbar, notification-bell, stat-card, widget-card, data-table, analytics-chart, breakdown-bar, live-sessions-widget, messages-view, session-timer, session-status, booking-steps, device-check, skeleton, toast, logout-button, pwa-install-prompt, GlassButton
│   │   ├── public/ (9)        — public-nav, public-footer, testimonials, register-banner, whatsapp-button, welcome-popup, free-trial-banner, mobile-register-bar
│   │   └── seo/ (1)           — structured-data
│   ├── lib/
│   │   ├── supabase/          — client.ts, server.ts, admin.ts, helpers.ts, middleware.ts
│   │   ├── supabase/migrations/ — v9_001, v10_001, v10_002, v11_001
│   │   ├── actions/           — evaluations.ts, homework.ts, notifications.ts
│   │   ├── notifications/     — parent.ts
│   │   ├── i18n/              — context.tsx, lang-toggle.tsx
│   │   ├── theme/             — context.tsx, theme-toggle.tsx
│   │   ├── stripe/            — .gitkeep (Stripe integration deferred)
│   │   ├── daily.ts           — Daily.co API (rooms, tokens, observer)
│   │   ├── email.ts           — Resend email integration
│   │   ├── whatsapp.ts        — WhatsApp via CallMeBot
│   │   ├── settings.ts        — Feature flags utilities
│   │   ├── feature-flags-context.tsx — Client-side flags provider
│   │   ├── constants.ts       — Arabic labels (session types, homework, packages, statuses)
│   │   ├── dashboard-queries.ts — Dashboard data aggregation
│   │   ├── cn.ts              — classNames utility
│   │   └── contact.ts         — Contact form handling
│   ├── types/
│   │   └── database.ts        — 29 table interfaces, 23 enums (889 lines)
│   ├── styles/
│   │   └── glass.css          — Liquid Glass Design System
│   └── proxy.ts               — Middleware route protection
├── supabase/
│   └── functions/             — 4 edge functions (auto-reminder, auto-complete, no-show-detector, weekly-report)
├── e2e/                       — Playwright tests
├── verification/              — Visual parity audit scripts
├── next.config.ts
├── tsconfig.json
├── vercel.json                — { installCommand: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install" }
├── .nvmrc                     — 20
├── CLAUDE.md                  — AI assistant instructions
├── AGENTS.md                  — Next.js version warning
└── PROJECT.md                 — This file
```

---

## 8. Codebase Statistics

| Metric | Count |
|--------|-------|
| Total TS/TSX files | 250 |
| Total lines of code | 25,057 |
| Route pages (page.tsx) | 77 |
| Shared components | 30 |
| Library utilities | 22 |
| Database tables | 29 |
| Type aliases/enums | 23 |
| Database interfaces | 29 |
| Server actions files | 3 (+ page-collocated) |
| Supabase edge functions | 4 |
| Migration files | 4 |
| Production dependencies | 19 |
| Dev dependencies | 8 |

### Pages by Role

| Role | Pages | Route Prefix |
|------|-------|-------------|
| Public | 8 | `/(public)/*` |
| Auth | 3 | `/(auth)/*` |
| Admin | 33 | `/admin/*` |
| Student | 12 | `/student/*` |
| Teacher | 11 | `/teacher/*` |
| Moderator | 10 | `/moderator/*` |

---

## 9. Design System

### Liquid Glass Design System v2

**Theme Colors:**
| Token | Dark | Light |
|-------|------|-------|
| `--background` | #0F0F0F | #FAFAF8 |
| `--foreground` | #F5F0E8 | #1A1A1A |
| `--gold` | #C8A652 | #B8963E |
| `--surface` | #1A1A1A | #FFFFFF |
| `--muted` | #9C9488 | #8A8A82 |
| `--error` | #E05555 | #DC2626 |
| `--success` | #4CAF7D | #16A34A |

**CSS Classes:**
| Class | Usage |
|-------|-------|
| `glass-card` | Frosted glass container with blur |
| `glass-gold` | Gold-tinted glass variant |
| `glass-success` | Green-tinted glass variant |
| `glass-pill` | Rounded pill button/badge |
| `glass-input` | Form input with glass styling |
| `glass-badge` | Small badge with glass effect |
| `neu-btn` | Neumorphic button shadow |
| `neu-inset` | Inset neumorphic shadow |
| `focus-ring` | Consistent focus ring |
| `stagger-children` | Staggered animation on grid children |

**Typography:**
| Font | Variable | Usage |
|------|----------|-------|
| IBM Plex Sans Arabic | `--font-body` | Body text (300-700 weights) |
| Rakkas | `--font-display` | Display headings (Arabic calligraphic) |
| Inter | `--font-inter` | Latin fallback |

**Styling Patterns:**
- RTL-first: `dir="rtl"` on root divs
- Containers: `mx-auto max-w-4xl px-4 py-8` (or max-w-5xl for tables)
- Cards: `glass-card p-6`
- Inputs: `glass-input w-full px-4 py-2.5`
- Status badges: `rounded-full border px-2 py-0.5 text-xs` with color variants
- Primary CTA: `glass-gold glass-pill px-8 py-3 text-lg font-semibold`
- All user-facing text in Arabic

---

## 10. Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client+Server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client+Server | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase admin key (bypasses RLS) |
| `NEXT_PUBLIC_APP_URL` | Client+Server | App base URL |
| `DAILY_API_KEY` | Server only | Daily.co video rooms |
| `RESEND_API_KEY` | Server only | Email sending |
| `ADMIN_EMAIL` | Server only | Admin notification recipient |
| `CALLMEBOT_KEY_KW` | Server only | WhatsApp (Kuwait) |
| `CALLMEBOT_KEY_EG` | Server only | WhatsApp (Egypt) |
| `CALLMEBOT_PHONE_KW` | Server only | WhatsApp phone (Kuwait) |
| `CALLMEBOT_PHONE_EG` | Server only | WhatsApp phone (Egypt) |
| `STRIPE_SECRET_KEY` | Server only | Stripe payments (deferred) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client | Stripe checkout (deferred) |
| `STRIPE_WEBHOOK_SECRET` | Server only | Stripe webhook verification (deferred) |

---

## 11. Deployment

| Setting | Value |
|---------|-------|
| Platform | Vercel Hobby plan |
| Domain | furqan.today |
| Node | 20.x (enforced by .nvmrc) |
| Git author | drdeebtech@gmail.com (required — Hobby plan blocks unrecognized authors) |
| Install command | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install` |
| Build | `npx next build` (Turbopack) |
| Supabase | Separate account (alforqan.egy@gmail.com) — not accessible via MCP |

### Verification Checklist
```bash
npx next build          # Must pass with zero errors
npm run lint            # No new errors
npx playwright test     # All existing tests pass
npx vercel ls furqan --prod  # Verify deployment succeeds
```

---

## 12. Supabase Edge Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `auto-reminder` | Cron | Send 24h + 1h session reminders |
| `auto-complete` | Cron | Auto-end stale sessions (2x duration) |
| `no-show-detector` | Cron | Flag missed sessions after 15min |
| `weekly-report` | Cron (weekly) | Admin weekly summary email |

Located in `supabase/functions/` — excluded from `tsconfig.json` (Deno runtime).

---

## 13. Homework State Machine (V10)

```
assigned (teacher creates after session)
  |
  v
student_ready (student clicks "I'm Ready")
  |
  v
Teacher grades → one of:
  ├── completed_excellent  (done)
  ├── completed_good       (done)
  ├── completed_needs_work (auto-creates new homework → parent notification)
  └── completed_not_done   (auto-creates new homework → parent notification)
```

- 6 types: hifz, muraja, recitation, tajweed, writing, listening
- Edit window: teacher can edit until next session starts
- Auto-regeneration chain via `parent_assignment_id` (linked list)
- Legacy `sessions.homework` text field preserved for backward compatibility

---

## 14. Session Lifecycle

```
BOOKING:  pending → confirmed → completed
                      |
                    cancelled / no_show

SESSION:  created → started → ended
```

1. Student books via `/student/bookings/new` → booking `pending`
2. Teacher confirms → `confirmed` + Daily.co room created
3. Both join video → session `started`
4. Teacher ends → session `ended`, booking `completed`
5. Post-session: teacher adds notes + structured homework + optional evaluation
6. Parent notified (session complete / no-show / evaluation)

---

## 15. PWA Configuration

```json
{
  "name": "فرقان — أكاديمية القرآن الكريم",
  "short_name": "فرقان",
  "display": "standalone",
  "background_color": "#0F0F0F",
  "theme_color": "#C8A652",
  "dir": "rtl",
  "lang": "ar"
}
```

- Service worker: cache-first for static assets, network-first for pages
- Install prompt: bottom banner with install/dismiss buttons
- iOS meta tags: apple-mobile-web-app-capable, black-translucent status bar

---

## 16. Future Roadmap

| Priority | Phase | Scope |
|----------|-------|-------|
| 1 | **Automation** | ~30 n8n workflows across 9 platform areas |
| 2 | **Advanced** | AI suggestions, recording transcription, Quran text display, gamification |
| 3 | **Stripe Integration** | Checkout sessions, webhook handler, package purchase flow (deferred until API keys ready) |

### Completed Phases
- Phase A: Homework System (V10)
- Phase B: Package & Pricing (V11)
- Phase C: In-App Notifications
- Phase D: Student Progress & Reports
- Phase E: Teacher Onboarding Polish
- Phase F: Student Discovery
- Phase G: Communication Enhancements
- Phase H: Progressive Web App (PWA)
