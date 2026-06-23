# App Screens Codemap

**Last Updated:** 2026-06-22
**Location:** `src/app/{admin,teacher,student,(public),(auth)}/...`

User-facing screens organized by role. Each screen path = a route in the Next.js App Router, with a `page.tsx` (content) and optional colocated `actions.ts` (route adapter).

---

## Architecture

```
src/app/
├── (public)/                    # Public, unauthenticated
├── (auth)/                      # Auth flows (login, signup, password reset)
├── admin/                       # Admin dashboard + tools
├── teacher/                     # Teacher dashboard + management
└── student/                     # Student dashboard + learning
```

**Routing notes:**
- `(public)` and `(auth)` are route groups (parentheses don't appear in URL)
- Each `page.tsx` is a Server Component by default; `"use client"` only when needed (state, hooks)
- Colocated `actions.ts` files are route adapters: they validate FormData, call domain functions, handle redirects

---

## Public & Auth Routes

| Route | File | Purpose | Auth Required |
|-------|------|---------|---|
| `/` | `(public)/page.tsx` | Homepage, landing page, product overview | No |
| `/about` | `(public)/about/page.tsx` | About the platform | No |
| `/contact` | `(public)/contact/page.tsx` | Contact form (newsletter, support) | No |
| `/blog` | `(public)/blog/page.tsx` | Blog posts (published content) | No |
| `/blog/[slug]` | `(public)/blog/[slug]/page.tsx` | Single blog post | No |
| `/faq` | `(public)/faq/page.tsx` | Frequently asked questions | No |
| `/pricing` | `(public)/pricing/page.tsx` | Pricing tiers (plans, features) | No |
| `/legal/privacy` | `(public)/legal/privacy/page.tsx` | Privacy policy | No |
| `/legal/terms` | `(public)/legal/terms/page.tsx` | Terms of service | No |
| `/login` | `(auth)/login/page.tsx` | Signin form (email, Google OAuth) | No |
| `/signup` | `(auth)/signup/page.tsx` | Student signup form | No |
| `/signup/teacher` | `(auth)/signup/teacher/page.tsx` | Teacher signup (CV upload) | No |
| `/password-reset` | `(auth)/password-reset/page.tsx` | Forgot password form | No |
| `/password-reset/[token]` | `(auth)/password-reset/[token]/page.tsx` | Reset password with token | No |

---

## Admin Dashboard

Entry point: `/admin/dashboard` — system overview, key metrics, quick actions.

| Route | File | Purpose | Called Actions |
|-------|------|---------|---|
| `/admin/dashboard` | `admin/dashboard/page.tsx` | Overview (health, pending approvals, payments) | — |
| `/admin/users` | `admin/users/page.tsx` | User management (search, suspend, deactivate) | `updateUserStatus`, `resetPassword` |
| `/admin/teachers` | `admin/teachers/page.tsx` | Teacher roster (active, inactive, CV review) | `approveTeacherCV`, `archiveTeacher` |
| `/admin/students` | `admin/students/page.tsx` | Student roster (active, inactive, linked guardians) | `deactivateStudent`, `unlinkGuardian` |
| `/admin/sessions` | `admin/sessions/page.tsx` | Session history (search, audit, notes) | `updateSessionNotes`, `deleteSession` |
| `/admin/bookings` | `admin/bookings/page.tsx` | Booking management (list, cancel, refund) | `cancelBooking`, `refundBooking` |
| `/admin/bookings/excuses` | `admin/bookings/excuses/page.tsx` | Absence excuse review (approve/reject) | `approveExcuse`, `rejectExcuse` (from `account.ts`) |
| `/admin/evaluations` | `admin/evaluations/page.tsx` | Session evaluation audit (search, view) | — |
| `/admin/payments` | `admin/payments/page.tsx` | Payment history (Stripe events, refunds) | — |
| `/admin/subscriptions` | `admin/subscriptions/page.tsx` | Active subscriptions (search, cancel, pause) | `cancelSubscription`, `refundSubscription` |
| `/admin/content` | `admin/content/page.tsx` | Content management (courses, lessons, videos) | `createCourse`, `updateCourse`, `deleteLesson` |
| `/admin/courses` | `admin/courses/page.tsx` | Course catalog (active, archived, enrollment) | `toggleCourseArchive`, `setCoursePrice` |
| `/admin/halaqas` | `admin/halaqas/page.tsx` | Halaqa (group class) management (schedule, roster) | `createHalaqa`, `assignTeacher` |
| `/admin/halaqas/assign` | `admin/halaqas/assign/page.tsx` | Assign teachers to halaqas | `assignTeacher` (from `class-offerings.ts`) |
| `/admin/community` | `admin/community/page.tsx` | Community moderation (posts, comments, flags) | `removePost`, `suspendUser` |
| `/admin/resources` | `admin/resources/page.tsx` | Learning resources (PDFs, links, materials) | `uploadResource`, `deleteResource` |
| `/admin/notifications` | `admin/notifications/page.tsx` | Broadcast messages, in-app announcements | `createBroadcast`, `scheduleBroadcast` |
| `/admin/announcements` | `admin/announcements/page.tsx` | System announcements (maintenance, features) | `createAnnouncement`, `retractAnnouncement` |
| `/admin/notes` | `admin/notes/page.tsx` | Session notes (search, edit, export) | `updateSessionNotes` |
| `/admin/reports` | `admin/reports/page.tsx` | Monthly reports (student, parent, teacher views) | — |
| `/admin/retention` | `admin/retention/page.tsx` | Retention dashboard (risk scores, churn signals) | `triggerRetentionBatch` |
| `/admin/audit` | `admin/audit/page.tsx` | Audit log (all actions, user timeline, rollback preview) | — |
| `/admin/automation` | `admin/automation/page.tsx` | n8n workflows (executions, logs, manual triggers) | `triggerAdminWorkflow` (n8n API proxy) |
| `/admin/n8n` | `admin/n8n/page.tsx` | n8n console (workflow status, failures, executions) | (n8n API proxy routes) |
| `/admin/settings` | `admin/settings/page.tsx` | Platform settings (feature flags, catalog) | — |
| `/admin/settings/tiers` | `admin/settings/tiers/page.tsx` | Subscription tier management (CRUD, pricing) | `updateTier`, `createTier` |
| `/admin/settings/prices` | `admin/settings/prices/page.tsx` | Pricing configuration (session rates, discounts) | `updatePricing` |
| `/admin/picklists` | `admin/picklists/page.tsx` | Lookup tables (evaluation options, excuse reasons) | `updatePicklist` |
| `/admin/legal` | `admin/legal/page.tsx` | Legal documents (policies, disclaimers) | `updatePolicy` |
| `/admin/refund-policies` | `admin/refund-policies/page.tsx` | Refund rules (conditions, windows, automations) | `updateRefundPolicy` |
| `/admin/moderation` | `admin/moderation/page.tsx` | Content moderation (reported posts, comments) | `approveContent`, `removeContent` |
| `/admin/help` | `admin/help/page.tsx` | Support tickets (search, assign, resolve) | `assignTicket`, `closeTicket` |
| `/admin/help/new` | `admin/help/new/page.tsx` | Create support ticket (internal use) | `createHelpTicket` |
| `/admin/health` | `admin/health/page.tsx` | System health (DB, email, Stripe, n8n) | `triggerHealthCheck` |
| `/admin/control-tower` | `admin/control-tower/page.tsx` | Control tower (snapshot, quick actions) | (read-only snapshot from `/api/admin/control-tower/snapshot`) |
| `/admin/reviews` | `admin/reviews/page.tsx` | Teacher CV review (pending, approved, rejected) | `approveCV`, `rejectCV` |
| `/admin/account` | `admin/account/page.tsx` | Admin profile settings | `updateProfile`, `updateAvatar` |
| `/admin/architecture` | `admin/architecture/page.tsx` | Architecture overview (tech stack, dependencies) | (read-only, documentation) |
| `/admin/tour` | `admin/tour/page.tsx` | Platform tour (help, onboarding) | (read-only, informational) |

---

## Teacher Dashboard

Entry point: `/teacher/dashboard` — students, sessions, follow-up, evaluations overview.

> **Scope:** this table lists rendered screens (`page.tsx`) only — it is **not** an exhaustive map of every booking-related route. Booking **confirm** and **new** flows are route adapters (`actions.ts`), not standalone teacher screens: `confirmBooking` is wrapped by `src/app/admin/bookings/actions.ts`, and the create-booking screen lives under the student tree (`/student/bookings/new`). There is no `/teacher/bookings/*` route tree.

| Route | File | Purpose | Called Actions |
|-------|------|---------|---|
| `/teacher/dashboard` | `teacher/dashboard/page.tsx` | Overview (upcoming sessions, student roster, follow-up pending, hours) | `getTeacherDashboard(client)` from views |
| `/teacher/students` | `teacher/students/page.tsx` | Student roster (search, progress summary, notes) | — |
| `/teacher/availability` | `teacher/availability/page.tsx` | Manage availability (weekly schedule, exceptions) | `updateAvailability`, `addException` |
| `/teacher/calendar` | `teacher/calendar/page.tsx` | Calendar view (sessions, availability, evaluations) | — |
| `/teacher/sessions` | `teacher/sessions/page.tsx` | Session history (upcoming, completed, no-show) | — |
| `/teacher/sessions/end` | `teacher/sessions/end/page.tsx` | End session (notes, evaluation, attendance) | `endSession` (from `teacher-session.ts`) |
| `/teacher/sessions/notes` | `teacher/sessions/notes/page.tsx` | Edit session notes (prep for next, parent message) | `updateSessionNotes` |
| `/teacher/follow-up` | `teacher/follow-up/page.tsx` | Homework assignments (pending, submitted, graded) | `getFollowUpAssignments`, `gradeFollowUp` |
| `/teacher/evaluations` | `teacher/evaluations/page.tsx` | Student evaluations (templates, history, export) | `createEvaluation`, `updateEvaluation` |
| `/teacher/progress` | `teacher/progress/page.tsx` | Student progress dashboard (surah, memorization, murajaah) | — |
| `/teacher/recitations` | `teacher/recitations/page.tsx` | Audio recitations (playback, rating, feedback) | `rateRecitation`, `addFeedback` |
| `/teacher/talqeen` | `teacher/talqeen/page.tsx` | Talqeen (corrections, tajweed notes) | `recordTalqeen`, `suggestCorrection` |
| `/teacher/courses` | `teacher/courses/page.tsx` | Courses authored (creation, enrollment, reviews) | `createCourse`, `updateCourse` |
| `/teacher/classes` | `teacher/classes/page.tsx` | Halaqas taught (roster, schedule, attendance) | `updateHalaqaSchedule` |
| `/teacher/halaqas` | `teacher/halaqas/page.tsx` | Halaqa management (same as classes, alt view) | — |
| `/teacher/messages` | `teacher/messages/page.tsx` | Direct messages (students, parents, admin) | `sendMessage`, `markMessageRead` |
| `/teacher/notifications` | `teacher/notifications/page.tsx` | Notification inbox (preferences, history) | `markNotificationRead`, `updateNotificationPrefs` |
| `/teacher/cv` | `teacher/cv/page.tsx` | CV/profile management (upload, review status) | `updateCV`, `submitForReview` |
| `/teacher/settings` | `teacher/settings/page.tsx` | Profile settings (bio, contact, preferences) | `updateProfile`, `updateAvatar` |
| `/teacher/account` | `teacher/account/page.tsx` | Account settings (password, email, linked accounts) | `resetPassword`, `updateEmail` |

---

## Student Dashboard

Entry point: `/student/dashboard` — next session, progress, murajaah due, credits overview.

| Route | File | Purpose | Called Actions |
|-------|------|---------|---|
| `/student/dashboard` | `student/dashboard/page.tsx` | Overview (next session, progress, murajaah due, credits) | `getStudentDashboard(client)` from views |
| `/student/teachers` | `student/teachers/page.tsx` | Teacher discovery & selection (profiles, ratings, availability) | `selectTeacher`, `scheduleFirstSession` |
| `/student/teachers?new=1` | `student/teachers/page.tsx` | Teacher onboarding (required for new students) | `selectTeacher` (redirect to dashboard on complete) |
| `/student/group-sessions` | `student/group-sessions/page.tsx` | Halaqas (enroll, schedule, attend) | `joinHalaqa`, `leaveHalaqa` |
| `/student/quizzes` | `student/quizzes/page.tsx` | Learning quizzes (available, in-progress, completed) | `submitQuiz`, `getQuizzes` |
| `/student/settings` | `student/settings/page.tsx` | Profile settings (avatar, bio, privacy, notification prefs) | `updateProfile`, `updateAvatar`, `setPrivacyPrefs` |
| `/student/account` | `student/account/page.tsx` | Account settings (password, email, linked accounts) | `resetPassword`, `updateEmail` |
| `/student/recite` | `student/recite/page.tsx` | Record recitation (audio capture, ayah selection) | `recordProgress`, `submitRecitation` |
| `/student/follow-up` | `student/follow-up/page.tsx` | Follow-up assignments (pending, submitted, graded feedback) | `getFollowUpAssignments`, `submitFollowUp` |
| `/student/follow-up/submit` | `student/follow-up/submit/page.tsx` | Submit homework (form, attachments, notes) | `submitFollowUp` (from `follow-up.ts`) |
| `/student/single-sessions` | `student/single-sessions/page.tsx` | Instant sessions (available specialists, book now) | `getSpecialists`, `bookInstantSession` |
| `/student/single-sessions/book` | `student/single-sessions/book/page.tsx` | Book instant session (Quran range, specialist match, checkout) | `selectSpecialist`, `createCheckout` |
| `/student/messages` | `student/messages/page.tsx` | Direct messages (teacher, parent, admin) | `sendMessage`, `markMessageRead` |
| `/student/notifications` | `student/notifications/page.tsx` | Notification inbox (preferences, history, mute) | `markNotificationRead`, `updateNotificationPrefs` |

---

## Shared Components & Patterns

**Route adapter pattern (colocated `actions.ts`):**
```typescript
// src/app/teacher/sessions/end/actions.ts
"use server"

export const endSessionAction = loudAction({
  name: 'teacher.end-session',
  audit: { table: 'sessions', recordId: s => s.id, action: 'UPDATE' },
  schema: z.object({ sessionId: z.string().uuid(), ... }),
  handler: async ({ sessionId, ... }) => {
    const { data: { user } } = await supabase.auth.getUser()
    // Calls session orchestrator
    return endSession({ sessionId, userId: user.id, ... })
  }
})
```

**Server Component (default for read-only screens):**
```typescript
// src/app/student/dashboard/page.tsx
export default async function StudentDashboard() {
  const client = await createClient()
  const dashboard = await getStudentDashboard(client)
  return <DashboardView data={dashboard} />
}
```

**Client Component (only when interactive: forms, modals, live updates):**
```typescript
"use client"
// Used sparingly — most views are Server Components
```

---

## Role-Based Access Control

**All routes are wrapped with role guards:**
- `requireAdmin()` in route `page.tsx` throws 403 if not admin
- `requireRole('teacher')` throws 403 if not teacher
- Public routes (landing, pricing) have no guards
- Auth routes check session; unauthenticated users see login

**Implementation:**
```typescript
// src/app/admin/dashboard/page.tsx
import { requireAdmin } from '@/lib/auth/require-admin'

export default async function AdminDashboard() {
  const { id } = await requireAdmin()  // Throws 403 if not admin
  // ...
}
```

---

## RTL & Arabic

Every screen must render correctly in RTL (Arabic, Urdu, etc.). No LTR assumptions.

- Tailwind: use `ltr:` / `rtl:` variants
- Flexbox: use `flex-row-reverse` in RTL mode
- Margins: use `ms-` (margin-start) instead of `ml-` (margin-left)
- Text direction: inherited from `<html dir="rtl">`

See component library for RTL examples.

---

## Layout Hierarchy

```
src/app/layout.tsx
├── Root layout (providers, Sentry, fonts, global CSS)
├── (public)/layout.tsx
│   └── Public navbar + footer
├── (auth)/layout.tsx
│   └── Auth form layout (centered, minimal)
├── admin/layout.tsx
│   ├── Admin navbar + sidebar
│   ├── Role check (requireAdmin)
│   └── [feature]/page.tsx
├── teacher/layout.tsx
│   ├── Teacher navbar + sidebar
│   ├── Role check (requireRole('teacher'))
│   └── [feature]/page.tsx
└── student/layout.tsx
    ├── Student navbar + sidebar
    ├── Onboarding redirect (/student/teachers?new=1 if no teacher)
    └── [feature]/page.tsx
```

---

## Related Maps

- [actions-and-views.md](./actions-and-views.md) — server actions & views that screens call
- [api-routes.md](./api-routes.md) — API endpoints for webhooks, cron, integrations
- [domains.md](./domains.md) — business logic that actions call

## See Also

- `CLAUDE.md` § 4 — code conventions (Server Components, typed events, RTL)
- `CONTEXT.md` § 1 — role definitions (student, teacher, admin)
- `src/components/` — reusable UI components (buttons, forms, tables)
- `.github/workflows/` — deployment to Vercel
