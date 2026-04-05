@AGENTS.md

# Git Identity Rule

Before making ANY git commit, you MUST ensure the git author matches the GitHub account:
```
git config user.email "drdeebtech@gmail.com"
git config user.name "drdeebtech"
```
Run this at the start of every conversation before committing. Vercel Hobby plan blocks deployments from unrecognized git authors on private repos. Do NOT rely on the machine default identity.

# Project Overview

FURQAN Academy — Online Quran teaching platform (V9)

## Stack
- **Next.js 16.2.2** (App Router, Turbopack) · **React 19** · **TypeScript 5**
- **Supabase** (PostgreSQL 17, Auth, RLS, Realtime) · **@supabase/ssr**
- **Daily.co** (Video sessions + observer mode)
- **Stripe** (Payments)
- **TailwindCSS 4** · **next-intl** (i18n, Arabic/English)
- **Deployed on Vercel** (Hobby plan, furqan.today)

## Roles (4)
- **student** — browse teachers, book sessions, join video, track progress
- **teacher** — manage availability, confirm bookings, conduct sessions, CV workflow
- **admin** — full platform management, user creation, evaluations, session observation
- **moderator** — users (students+teachers only), CV review, session observation, evaluations, audit log (read-only)

## Key Architecture
- **Route protection**: `src/proxy.ts` — role-based middleware, admin can access `/moderator/*`
- **Server actions**: `"use server"` pattern with `revalidatePath`, `as never` casts for Supabase
- **Admin client**: `src/lib/supabase/admin.ts` — service-role client for user creation
- **Feature flags**: `src/lib/settings.ts` + `platform_settings` table (`hide_reviews`, `hide_prices`)
- **Parent notifications**: `src/lib/notifications/parent.ts` — report system for parents
- **Session observation**: Daily.co observer tokens with mic/camera off, max_participants bumped to 3

## Database (25 tables)
Original 20 tables + 5 V9 tables:
- `platform_settings` — key-value feature flags
- `session_evaluations` — student evaluation scores
- `parent_reports` — parent notification reports
- `session_notes_history` — notes edit audit trail
- `session_observers` — observation tracking

## V9 Enums
- `cv_status`: draft | pending_review | approved | rejected
- `evaluation_type`: weekly | biweekly | monthly | quarterly
- `report_type`: session_summary | evaluation | custom | missed_session | schedule_change

## V9 SQL Functions
- `is_moderator()` — checks if user has moderator role
- `is_admin_or_mod()` — checks if user is admin or moderator

## Edge Functions (Supabase)
- `auto-reminder` — 24h + 1h session reminders
- `auto-complete` — auto-end stale sessions (2x duration)
- `no-show-detector` — flag missed sessions
- `weekly-report` — admin weekly summary

## File Structure (key paths)
```
src/
├── app/
│   ├── (auth)/          — login, register, forgot-password
│   ├── (public)/        — landing, about, contact, packages, teachers, blog
│   ├── admin/           — full admin dashboard (users, teachers, bookings, sessions, evaluations, settings)
│   ├── moderator/       — moderator dashboard (users, cv-review, sessions, evaluations, audit)
│   ├── student/         — student portal (dashboard, teachers, bookings, sessions, progress, messages)
│   ├── teacher/         — teacher portal (dashboard, sessions, availability, students, cv, evaluations, messages)
│   └── api/             — webhooks (stripe, bookings)
├── components/
│   ├── shared/          — nav, session-timer, session-status, device-check, logout-button
│   └── public/          — testimonials, public-nav, public-footer, whatsapp-button
├── lib/
│   ├── supabase/        — client.ts, server.ts, middleware.ts, admin.ts
│   ├── actions/         — evaluations.ts (shared admin+moderator)
│   ├── notifications/   — parent.ts
│   ├── i18n/            — context.tsx, lang-toggle.tsx
│   ├── daily.ts         — Daily.co API (rooms, tokens, observer tokens)
│   ├── settings.ts      — feature flags utilities
│   ├── feature-flags-context.tsx — client-side flags provider
│   └── constants.ts     — Arabic labels for session types, statuses
├── types/
│   └── database.ts      — all TypeScript types (25 tables, 11 enums)
└── proxy.ts             — middleware route protection
supabase/functions/      — 4 edge functions (auto-reminder, auto-complete, no-show-detector, weekly-report)
```

## Styling Patterns
- RTL-first: `dir="rtl"` on root divs
- Containers: `mx-auto max-w-4xl px-4 py-8` (or max-w-5xl for tables)
- Cards: `rounded-2xl border border-card-border bg-card p-6`
- Inputs: `w-full rounded-xl border border-input-border bg-input neu-inset px-4 py-2.5`
- Status badges: `rounded-full border px-2 py-0.5 text-xs` with color variants
- Gold accent: `text-gold`, `bg-gold`, `border-gold/30`
- All user-facing text in Arabic
