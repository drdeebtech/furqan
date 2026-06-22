# Actions & Views Codemap

**Last Updated:** 2026-06-22
**Location:** `src/lib/actions/**` (30 files), `src/lib/views/**` (2 files)

This layer contains **server actions** (request handlers, route adapters) and **per-screen read bundles** (queries for dashboard widgets). Route adapters live here AND colocated in `src/app/role/feature/actions.ts`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  src/lib/actions/**                                        │
│  Cross-role server actions + route adapters                │
│  Each exports "use server" declarations                    │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  src/lib/views/**                                          │
│  Per-screen read bundles (injected client = test seam)     │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  src/app/{role}/{feature}/actions.ts (colocated)           │
│  Route-specific adapters (FormData, redirects)             │
│  Re-export from src/lib/actions/** (barrel pattern)        │
└──────────────────────────────────────────────────────────────┘
```

## Barrel Pattern (Critical)

**Problem:** A `"use server"` re-export barrel (`src/app/teacher/dashboard/actions.ts`) that re-exports client components breaks Turbopack — the client ref is dropped, build fails.

**Solution:**
- **Leaf files** (`src/lib/actions/*.ts`) carry `"use server"` declaration
- **Barrels** (`src/app/role/feature/actions.ts`) carry **NO** `"use server"`
- Each barrel is a passive re-export only

**Always verify:** `npm run build` (not just `tsc`). Turbopack catches this; `tsc` does not model the server/client boundary.

See memory: `["use_server_barrel_breaks_turbopack"]`.

---

## Server Actions (Cross-Role)

### Authentication & Authorization

| File | Purpose | Key Exports | Wrapping |
|------|---------|---|---|
| `account.ts` | Profile update, avatar upload, password reset, excuse approval | `updateProfile`, `updateAvatar`, `resetPassword`, `approveExcuse` | `loudAction` with audit |
| `active-role.ts` | Role switching, cache invalidation | `setActiveRole`, `getActiveRole` | `loudAction` |
| `user-error.ts` | Custom error class for user-facing failures | `UserError`, type guard `isUserError` | N/A (utility) |
| `loud.ts` | Universal error wrapper for actions | `loudAction`, error handling contracts | N/A (wrapper) |

**Auth boundary:**
- Every action checks `requireRole(role)` at entry
- Extracts `userId` from session, **never** from input
- Route validators use Zod before any side-effect

### Teaching & Sessions

| File | Purpose | Key Exports | Wrapping |
|------|---------|---|---|
| `teacher-booking.ts` | `confirmBooking` orchestration (5-step sequence) | `confirmBooking` | **Not wrapped** (returns `{ roomUrl, warning }` for optimistic UI) |
| `teacher-session.ts` | `endSession`, `markNoShow`, `savePostSessionNotes` | Session lifecycle + eval creation | `loudAction` |
| `evaluations.ts` | Create/update session evaluations (teacher & student) | `createEvaluation`, `updateEvaluation` | `loudAction` |
| `session-lesson-plan.ts` | Fetch session prep notes, update for next session | `getSessionPlan`, `updateSessionPlan` | `loudAction` |

### Student & Progress

| File | Purpose | Key Exports | Wrapping |
|------|---------|---|---|
| `follow-up.ts` | Student homework submissions, schema validation | `submitFollowUp`, `getFollowUpAssignments` | `loudAction` |
| `follow-up-schemas.ts` | Define + validate homework submission schemas | `getFollowUpSchema`, `validateSubmission` | N/A (utility) |
| `progress-schemas.ts` | Schemas for progress capture (recitation, evaluation) | Progress-related schemas | N/A (utility) |
| `study-log.ts` | Log student study sessions (informal practice) | `logStudySession`, `getStudyLog` | `loudAction` |

### Courses & Content

| File | Purpose | Key Exports | Wrapping |
|------|---------|---|---|
| `courses.ts` | List, create, update courses (mini-lessons) | `getCourses`, `createCourse`, `updateCourse` | `loudAction` |
| `course-enrollments.ts` | Student course signup, progress tracking | `enrollStudent`, `getEnrollments` | `loudAction` |
| `course-lessons.ts` | Lesson within a course, update progress | `getLessons`, `markLessonComplete` | `loudAction` |
| `course-playback.ts` | Video playback state (resume, timestamp) | `updatePlaybackState`, `getPlaybackState` | `loudAction` |
| `course-reviews.ts` | Student reviews of courses | `createReview`, `getReviews` | `loudAction` |
| `quizzes.ts` | Quiz submission, grading | `submitQuiz`, `getQuizzes` | `loudAction` |

### Community & Engagement

| File | Purpose | Key Exports | Wrapping |
|------|---------|---|---|
| `community.ts` | Group discussions, wall posts, community features | `createPost`, `likePost`, `getTimeline` | `loudAction` |
| `notifications.ts` | Mark read, fetch inbox, manage preferences | `markNotificationRead`, `getNotifications` | `loudAction` |
| `help.ts` | Help ticket creation, status tracking | `createHelpTicket`, `getTickets` | `loudAction` |

### Resources & Support

| File | Purpose | Key Exports | Wrapping |
|------|---------|---|---|
| `resources.ts` | Learning materials, PDFs, links | `getResources`, `uploadResource` | `loudAction` |
| `modules.ts` | Course modules, structure, curriculum | `getModules`, `createModule` | `loudAction` |

### Billing & Subscriptions

| File | Purpose | Key Exports | Wrapping |
|------|---------|---|---|
| `subscriptions/create-hifz-subscription.ts` | Initiate Hifz plan checkout (calls Stripe SDK) | `createHifzSubscription` | `loudAction` with Stripe error handling |

### Admin & Operations

| File | Purpose | Key Exports | Wrapping |
|------|---------|---|---|
| `class-offerings.ts` | Admin: manage halaqas, cohorts, class schedules | `createClassOffering`, `assignTeacher` | `loudAction` |
| `cache.ts` | Manual cache invalidation (dev/admin) | `clearCache`, `revalidatePath` | Unsafe (debug only) |
| `retention-batch.ts` | Trigger retention scoring batch | `triggerRetentionBatch` | `loudAction` |
| `retention-scoring.ts` | Compute student retention risk scores | `computeRetentionScore` | `loudAction` |
| `route-action.ts` | Unified next/navigation route utilities | Route action helpers | N/A (utility) |

---

## Views (Read Bundles)

These are **per-screen read bundles** that package queries for a single dashboard. The client is **injected**, making them test-seams.

### Dashboard Reads

| File | Screen | Purpose | Key Exports |
|---|---|---|---|
| `student-dashboard.ts` | `/student/dashboard` | Student overview: credits, next session, progress summary, murajaah due | `getStudentDashboard(client)`, `DashboardWidgets` type |
| `teacher-dashboard.ts` | `/teacher/dashboard` | Teacher overview: upcoming sessions, student roster, evaluations pending, hours worked | `getTeacherDashboard(client)`, `DashboardWidgets` type |

**Pattern:**
```typescript
// Injected client (allows swapping real ← → test client)
export async function getStudentDashboard(client: SupabaseClient) {
  const [credits, nextSession, progress] = await Promise.all([...])
  return { credits, nextSession, progress }
}
```

**Entry point:** Route calls with `createClient()` (real) or test injects mock.

---

## Route Adapters (Colocated)

These live in `src/app/{role}/{feature}/actions.ts` and are NOT wrapped in `loudAction` when they end with `redirect()`. Route adapters own the HTTP/FormData/auth boundary.

### Teacher Routes

| Route | File | Calls Domain | Pattern |
|-------|------|---|---|
| `/teacher/bookings/confirm` | `teacher/bookings/confirm/actions.ts` | `booking.orchestrate.confirmBooking()` | Try-catch, redirect on success; re-render form on error |
| `/teacher/bookings/new` | `teacher/bookings/new/actions.ts` | `booking.actions.createBooking()` | FormData parse, redirect |
| `/teacher/sessions/end` | `teacher/sessions/end/actions.ts` | `session.orchestrate.endSession()` | FormData parse, redirect |
| `/teacher/sessions/notes` | `teacher/sessions/notes/actions.ts` | `reports.notes.updateNotes()` | FormData parse, loudAction wrapper |

### Admin Routes

| Route | File | Calls Domain | Pattern |
|-------|------|---|---|
| `/admin/bookings/excuses` | `admin/bookings/excuses/actions.ts` | `attendance.excuses.approveExcuse()` | loudAction |
| `/admin/halaqas/assign` | `admin/halaqas/assign/actions.ts` | `scheduling.assignments.assignTeacher()` | loudAction |
| `/admin/settings/tiers` | `admin/settings/tiers/actions.ts` | `catalog.tiers.updateTier()` | loudAction |

### Student Routes

| Route | File | Calls Domain | Pattern |
|-------|------|---|---|
| `/student/follow-up/submit` | `student/follow-up/submit/actions.ts` | `follow-up.actions.submitFollowUp()` | FormData parse, loudAction |
| `/student/single-sessions/book` | `student/single-sessions/book/actions.ts` | `single-sessions.*.selectSpecialist()` | loudAction |

**Key detail:** Route adapters are thin — they parse FormData, validate with Zod, extract userId from session, then call domain functions. Domain functions know nothing about HTTP.

---

## Utilities

| File | Purpose | Used By |
|------|---------|---------|
| `loud.ts` | `loudAction` wrapper — unified error handling, audit logging, severity tagging, Telegram alerts | All domain-calling actions |
| `user-error.ts` | `UserError` class — user-facing message + optional system `cause` | Preflight validation, wrapped system errors |
| `route-action.ts` | Next.js route helpers (revalidate, redirect, notFound) | Route adapters |

---

## Error Handling Pattern

**loudAction wraps system errors:**

```typescript
export const myAction = loudAction({
  name: 'teacher.confirm-booking',
  audit: { table: 'bookings', recordId: b => b.id, action: 'UPDATE' },
  severity: 'critical',
  schema: z.object({ bookingId: z.string().uuid() }),
  handler: async ({ bookingId }) => {
    const booking = await supabase.from('bookings').select().eq('id', bookingId).single()
    if (!booking) throw new UserError('حجز غير موجود')  // User error — skips Sentry/Telegram
    
    const { error } = await supabase.from('bookings').update({ status: 'confirmed' })...
    if (error) throw new UserError('فشل التأكيد', { cause: error })  // System wrapped in user message
    
    return { message: 'تم التأكيد' }
  }
})
```

**Returns:**
- `{ ok: true, message }` on success + audit row written
- `{ ok: false, error }` on validation failure (no side-effects)
- `{ ok: false, error, message }` on system failure (Sentry + audit + Telegram if severity=critical)

---

## Related Maps

- [domains.md](./domains.md) — business logic owners that actions call
- [api-routes.md](./api-routes.md) — webhooks & cron that trigger actions
- [app-screens.md](./app-screens.md) — user-facing screens that call actions
- `CLAUDE.md` § 6.1 — "use server" barrel pattern warning

## See Also

- `CONTEXT.md` § 3 — role-gating primitives (`requireRole`, `requireAdmin`)
- `src/lib/auth/require-admin.ts` — role check implementation
- `src/lib/logger.ts` — `logError` with route/widget tags
