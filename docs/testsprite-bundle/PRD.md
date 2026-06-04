# FURQAN Academy — Product Requirements (PRD for TestSprite)

> Spec-driven test input for the TestSprite Web Portal. Describes what the product
> is *supposed to do* so TestSprite can build an accurate feature map before planning
> tests. Pair this with `openapi.yaml` (API surface) in the same upload.

## 1. Product Summary

**FURQAN Academy** is an online Quran-teaching platform connecting students with
certified (Ijazah-holding) teachers for live video lessons in memorization (Hifz),
recitation, and Tajweed. The UI is **Arabic-first, right-to-left**; bilingual
Arabic + English hints are optional. The platform is sized for **50,000 users**.

- **Production URL:** https://www.furqan.today (apex `furqan.today` 307-redirects to www)
- **Stack:** Next.js 16 (App Router, React 19), Supabase (Postgres + Auth + RLS),
  Stripe (payments), Daily.co (video), Bunny.net (recorded video), n8n (automation/cron), Sentry.

## 2. Roles & Permissions

Exactly three roles (a `profiles.role` enum + a `profiles.roles[]` array; the CHECK
constraint `role = ANY(roles)` keeps them consistent):

| Role | Capabilities |
|------|--------------|
| **student** | Book/attend sessions, buy packages, take courses & quizzes, do memorization reviews, view own reports |
| **teacher** | Manage own courses/modules/lessons, run sessions, write session reports, manage availability |
| **admin** | Full platform control: user management, control-tower dashboard, n8n workflow ops, audits |

There is **no moderator role** (dropped 2026-05-08; legacy `/moderator/*` URLs 301→`/admin/*`).
Authorization is enforced server-side via `requireRole`/`requireAdmin`; unauthorized access returns 401 (unauthenticated) or 403 (wrong role).

## 3. Core Features (feature map intent)

### 3.1 Authentication & Session
- Email + Google OAuth sign-in via Supabase. Successful auth lands on a role-based dashboard; a **forged/invalid OAuth code must redirect to `/login?error=…`, never to a dashboard.**
- **Cross-device handoff:** a QR/code lets a signed-in user transfer a session to another device. Codes are **one-time and short-lived** — a consumed or unknown code must return **410 Gone**.
- Logout clears the session and returns the user to the public site.

### 3.2 Bookings & Live Sessions
- Students book lesson slots with teachers; sessions run over Daily.co video.
- Session lifecycle (scheduled → in-progress → completed/no-show) is driven by webhooks and scheduled jobs (auto-complete past-end sessions, record no-shows).
- *(Note: the public `/api/bookings` REST surface is an intentional placeholder; booking flows run through server actions.)*

### 3.3 Courses, Modules, Lessons, Quizzes
- Teachers author courses → modules → lessons (some with recorded Bunny.net video) and quizzes.
- Students enrol, play lessons, take quizzes, and leave course reviews.

### 3.4 Memorization & Spaced Repetition (Murajaah)
- Tracks each student's memorized portions and computes review schedules with an **SM-2 spaced-repetition** algorithm.
- Nightly jobs compute due reviews and surface them to students; falling-behind signals route to the teacher side (forgiving, non-shaming UX).

### 3.5 Payments (Packages)
- Students purchase session **packages** via Stripe Checkout; fulfillment grants session credits.
- **Current state:** the Stripe *initiate* side and webhook are intentionally not fully wired (Stripe SDK not installed) and **fail closed** — checkout returns 501 after recording a pending payment; the webhook returns 501 unconditionally so unsigned payloads can never grant a paid package. Treat these 501s as **expected**, not failures.

### 3.6 Notifications
- All user-facing notifications go through a single dispatcher (`notify()`/`dispatchNotification()`); no direct table inserts. Arabic copy.

### 3.7 Teacher Infrastructure
- Teacher profiles (auto-provisioned when a profile's role becomes `teacher`), availability, session reports sent to students/guardians.

### 3.8 Admin Control Tower & Automation
- Admin dashboard aggregates platform health (sessions, payments, alerts).
- Admins manage **n8n** workflows/executions through guarded proxy endpoints.
- Scheduled **cron** jobs (run by n8n on a Mac mini) handle cleanup, reconciliation, retention scoring, email health, murajaah compute, etc. Every cron endpoint requires **dual secrets** (`Authorization: Bearer CRON_SECRET` + `X-N8N-Secret`); missing/invalid secrets must be rejected.

### 3.9 Retention
- A scoring job computes per-student retention-risk scores; deep gaps route to teacher-side panels rather than shaming the returning student.

## 4. Security Expectations (test these)

- **Auth gates hold:** protected endpoints reject anonymous requests with 401 and wrong-role requests with 403.
- **Webhook signatures verified:** Daily.co and Bunny.net webhooks verify HMAC signatures; an invalid/missing signature must be rejected with **401** (in production, where the secrets are configured). Stripe webhook is hard-disabled (501).
- **Cron dual-auth:** cron endpoints reject any request lacking both secrets.
- **No anonymous writes:** every state-changing endpoint requires a valid session or secret; there must be no anonymous path to create payments, bookings, or mutate data.
- **Method discipline:** endpoints reject unsupported HTTP methods with 405 (e.g. cron endpoints are GET-only).

## 5. Known Intentional States (NOT bugs)

| Endpoint | Returns | Why |
|----------|---------|-----|
| `GET/POST /api/bookings` | 501 | Intentional stub; forces a future dev to add auth + RLS-scoped query |
| `POST /api/stripe/checkout` | 501 (after recording pending payment) | Stripe SDK not installed yet; initiate side unimplemented |
| `POST /api/stripe/webhook` | 501 | Hard-disabled by design so unsigned payloads can't grant packages |

## 6. Test Accounts

For **API/UI authenticated testing on the Web Portal**, use TestSprite **Auto-Auth (Pro)**
with real test-account credentials (one per role: student, teacher, admin). The platform
has no anonymous-bypass login in production by design, so authenticated coverage requires
real credentials supplied to the portal's credential store.

## 7. Coverage Note

The majority of business logic lives in **Next.js server actions** (`src/lib/actions/**`),
not REST routes — so **UI (frontend) testing against the live app covers more product
behavior than API testing**. Recommended split:
- **UI project** → user journeys (sign-in, booking, course playback, quiz, memorization review, checkout) against https://www.furqan.today.
- **API project** → the REST perimeter in `openapi.yaml` (auth gates, webhook signature rejection, cron dual-auth, method discipline).
