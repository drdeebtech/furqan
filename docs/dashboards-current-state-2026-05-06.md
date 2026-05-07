# Dashboards — Current State Audit

> Ground-truth audit of the four role dashboards on the FURQAN platform, captured 2026-05-06 from the actual code on `fix/sentry-release-gate-prod-only`. **No `/docs/*.md` was consulted — every claim cites a real file:line in the repo today.** Scope intentionally limited to `src/app/{role}/dashboard/` — sibling routes (e.g. `/admin/users`, `/admin/control-tower`) are out of scope and will be audited in later sessions.

---

## 1. Student Dashboard

### A. File inventory
- **page.tsx** — `src/app/student/dashboard/page.tsx` — 257 lines (server component)
- **dashboard-content.tsx** — 548 lines (client, `"use client"`) — imported by page.tsx
- **next-action-banner.tsx** — 333 lines (client) — imported by dashboard-content.tsx
- **welcome-header.tsx** — 246 lines (client) — imported by dashboard-content.tsx
- **todays-plan.tsx** — 126 lines (client) — imported by dashboard-content.tsx
- **murajaah-card.tsx** — 135 lines (client) — imported by dashboard-content.tsx
- **lesson-row-actions.tsx** — 119 lines (client) — imported by dashboard-content.tsx
- **guidance-banner.tsx** — 49 lines (client) — **DEAD: not imported anywhere**
- **quick-actions.tsx** — 29 lines (client) — **DEAD: not imported anywhere** (an unrelated `admin/control-tower/quick-actions` is imported elsewhere)
- **loading.tsx** — 97 lines — present
- **error.tsx** — none in `dashboard/`; sibling `src/app/student/error.tsx` (44L) handles it
- **layout.tsx** — `src/app/student/layout.tsx` — 5 lines, wraps `<DashboardLayout role="student">`

### B. Data layer
All queries are explicit columns (zero `select("*")` across page + child server queries).

**page.tsx round-trips (server-side):**
1. `profiles.select("full_name")` `.eq(id)` `.single()` — page.tsx:58 (Promise.all)
2. `bookings` next confirmed-future, limit 1 — page.tsx:59 (Promise.all)
3. `bookings` count completed total — page.tsx:47-51 (Promise.all)
4. `bookings` count completed-this-month — page.tsx:53-55 (Promise.all)
5. `bookings` count pending — page.tsx:67 (Promise.all)
6. `profiles.select("full_name")` of next-booking teacher — page.tsx:96 — **NOT in Promise.all** (sequential)
7. `sessions.select("id")` `.maybeSingle()` — page.tsx:109 — **NOT in Promise.all** (sequential, conditional)
8. `student_packages` active — page.tsx:121 (2nd Promise.all)
9. `homework_assignments.select("status")` ALL rows ever for student — page.tsx:125 — **unbounded**
10. `getStudentStudyAnalytics` — page.tsx:128 → 3 internal queries
11. `getStudentLiveSessions` — page.tsx:129 → 3 sequential
12. `getStudentContinueWatching` — page.tsx:130 → 3 sequential (with embed `lesson:course_lessons(...course:courses(...))`)
13. `getStudentRecentRecordings` — page.tsx:131 → 1 + Promise.all(2)
14. `getStudentNextQuiz` — page.tsx:132 → 3 sequential
15. `student_progress` latest — page.tsx:133 (2nd Promise.all)
16. `getStudentStreak` — page.tsx:139 → 2 sequential
17. `getStudentHomeworkPulse` — page.tsx:140
18. `session_evaluations.select("next_goals, evaluation_type, created_at")` latest — page.tsx:144 (2nd Promise.all)
19. `getStudentMurajaahPlan` — page.tsx:151 → 5 queries inside one Promise.all
20. `bookings` today's confirmed — page.tsx:190 (3rd Promise.all)
21. `homework_assignments` today's due — page.tsx:196 (3rd Promise.all)
22. `profiles` for today's-session teacher_ids — page.tsx:216 — **NOT in Promise.all** (sequential)

**Round-trip count:** ~22 queries across 5 sequential Promise.all batches with 3 sequential single-shots interleaved. **No RPCs / views.**
**Polling:** `setInterval(setNow, 60_000)` — dashboard-content.tsx:91 and next-action-banner.tsx:47 (two independent timers).
**Realtime:** none.

### C. Visual structure
**Outermost containers (verbatim):**
- dashboard-content.tsx:258 — `<div className="student-dashboard-skin">`
- dashboard-content.tsx:268 — `<div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10" id="student-main">`

**Render order:** Skip-link → `WelcomeHeader` → `NextActionBanner` → "teacher's focus" inline card (conditional) → 4-KPI grid (`StatCard`×4) → `TodaysPlan` → `MurajaahCard` → `WidgetCard`+`AnalyticsChart` (lg:col-span-3) → `LiveSessionsWidget` → `BreakdownBar` → `DataTable` (continue-watching/recordings) → footer + shortcuts → `ShortcutsHelp` modal.

**glass usage:** Delegated to shared components (`StatCard`, `WidgetCard`, `DataTable`); `glass-gold glass-pill` on PrimaryAction in NextActionBanner. `loading.tsx` uses `glass-card` on all 4 KPI placeholders + 3 widgets. **The dead `guidance-banner.tsx` and `quick-actions.tsx` use `glass-card` directly.**

**Empty states:** All major sections wrapped in `SectionErrorBoundary` with `fallbackLabel`. `TodaysPlan` renders `EmptyPlan` (todays-plan.tsx:95-126) with friendly Arabic+English + book-session CTA. `MurajaahCard` `return null` when nothing-yet-memorized (murajaah-card.tsx:39); shows quiet "done" when `reviewedToday`. New-student edge-case redirects to `/student/teachers?new=1` (page.tsx:89).

**Skeletons:** `loading.tsx` ships welcome row, banner, 4 stat cards, chart+widgets row, data table. **Missing skeletons for `TodaysPlan`, `MurajaahCard`, "focus this week" card** — these flash in.

**Status badges/pills:** `StatCard.statusBadge` is color-coded only; KPI icons (Briefcase / CheckCircle / Calendar / Clock) sit on card body, separate from the badge.

### D. RTL / i18n
- **Hardcoded English (no `t()`):** 2 fallbacks only — `aria-label="Next action"` (next-action-banner.tsx:273) and `subtitle ?? "session"` fallback returned from helper (dashboard-content.tsx:495).
- **Hardcoded Arabic without `t()`:** none in dashboard files.
- **`text-left|text-right|ml-*|mr-*|pl-*|pr-*`:** **0 occurrences** ✅. Codebase uses logical `start-`/`end-`/`ms-`/`me-` consistently.
- **Locale-coupled date formatters:** 6 instances; all run inside client components, so they get the locale at runtime. `<span suppressHydrationWarning>` papers over SSR/CSR divergence at dashboard-content.tsx:96, 516; next-action-banner.tsx:165; todays-plan.tsx:79.
- **Directional icons:** `ArrowLeft`/`ArrowRight` flipped by `dir === "rtl"` at next-action-banner.tsx:41 and todays-plan.tsx:32. ✅

### E. Known bugs / smells
- **Dead files** (78L total): `guidance-banner.tsx` and `quick-actions.tsx` unreferenced.
- **Unbounded query** at page.tsx:125-127 — fetches ALL `homework_assignments` rows ever, just to count statuses.
- **N+1 sequential follow-ons** — page.tsx:96, 109, 216 run *after* the first Promise.all. Could fold into the batch.
- **Dual 60s timers** — dashboard-content + next-action-banner each spin their own ticker; two re-renders/min instead of one.
- **Hydration risk masked** by 4× `suppressHydrationWarning` — server/client locale divergence is suppressed, not solved.
- `<a href>` instead of `<Link>` at dashboard-content.tsx:319 (link to `/student/progress` causes full reload).
- No `select("*")`. No `as never` casts. No `requireAdmin` concerns (student route).

### F. Quick wins ranked
1. **Delete dead files** — `guidance-banner.tsx` + `quick-actions.tsx`. ~2 min. Frees 78L, removes grep noise.
2. **Replace homework status fetch with 6 head-counts (or RPC)** — page.tsx:125-127. ~25 min. Removes the only unbounded query on the route.
3. **Fold sequential teacher-name lookups into main Promise.all** — pre-collect teacher_ids from next-booking + today's sessions before either query runs. page.tsx:96, 216. ~15 min. Saves 2 round-trips per render.
4. **Consolidate dual 60s ticker** — lift `now` into a shared context or pass server `renderedAtMs` down. next-action-banner.tsx:43-49. ~20 min.
5. **Replace `<a href="/student/progress">` with `<Link>`** — dashboard-content.tsx:319. ~3 min. Removes one full-document reload.

---

## 2. Teacher Dashboard

### A. File inventory
- `src/app/teacher/dashboard/page.tsx` — 277 lines (server component, async)
- `src/app/teacher/dashboard/dashboard-content.tsx` — 445 lines (`"use client"`)
- `src/app/teacher/dashboard/actions.ts` — 566 lines (server actions, **no `loud()`**)
- `welcome-header.tsx` — 116L (client) · `next-action-banner.tsx` — 279L (client) · `guidance-banner.tsx` — 153L
- `action-queue.tsx` — 76L (client) · `quick-actions.tsx` — 47L · `teacher-session-card.tsx` — 313L (client)
- `booking-actions.tsx` — 124L · `instant-session.tsx` — 134L
- `at-risk-students.tsx` — 104L (server, self-fetching) · `mentorship-card.tsx` — 147L (server, self-fetching)
- `talqeen-inbox-card.tsx` — 163L (server, +Skeleton) · `roster-error-pulse.tsx` — 131L (server, +Skeleton)
- `parent-report-digest-card.tsx` — 161L (server, +Skeleton) · `recitation-standard-roster.tsx` — 105L (server, +Skeleton)
- `loading.tsx` — 123 lines · `error.tsx` — none in `dashboard/`; covered by `src/app/teacher/error.tsx`
- Layout: `src/app/teacher/layout.tsx` — 5 lines (`<DashboardLayout role="teacher">`)

### B. Data layer
**page.tsx Batch 1 `Promise.all` (15 round-trips, parallel):**
1. `profiles` (full_name, phone, avatar_url) `.single()` — page.tsx:52
2. `teacher_profiles` (total_sessions, rating_avg, cv_status, bio) — :53
3. `bookings` pending — :55
4. `bookings` today (confirmed, today range) — :57
5. `bookings` month count head — :61
6. `bookings.select("student_id")` `in ["confirmed","completed"]` — :66 — **unbounded**
7. `teacher_availability` count head — :67
8. `homework_assignments` count head — :68
9. `conversations.select("id")` — :69 — **unbounded**
10. `getTeacherWeeklyHours` — :71
11. `getTeacherLiveSessions` — :72
12. `getTeacherSessionTypeBreakdown` — :73
13. `getTeacherRecentStudents` — :74
14. `getTeacherTimeToGrade` — :75
15. `supabase.rpc("get_teacher_overdue_eval_count" as never, ...)` — :100

**Batch 2 `Promise.all` (depends on batch 1) — 2 RTs:**
- `messages` count head `.in(conversation_id, convIds)` — :152
- `sessions` `.in(booking_id, todayBookingIds)` — :157

**+1** post-batch: `fetchNameMap(supabase, allStudentIds)` — :186.

**Total root-page round-trips: ~18.**

**Streamed Suspense components (each fetch independently):**
- `talqeen-inbox-card` `getTeacherTalqeenInbox` (:54) · `roster-error-pulse` `getTeacherRosterErrorPulse` (:29) · `parent-report-digest-card` `getTeacherParentReportDigest` (:45) · `recitation-standard-roster` `getTeacherRecitationStandardRoster` (:30)
- `at-risk-students` — 3 queries (`bookings` 90d **unbounded** :36, `retention_signals` limit 5 :46, `profiles` :57)
- `mentorship-card` — 3 queries (`teacher_mentorships` no limit :22, `profiles` :39, `teacher_mentorship_feedback` limit 1 :52)

No `select("*")`. No client-side polling against Supabase. No Realtime.
**Client `setInterval`s (clock ticks only):** dashboard-content.tsx:83 (60s) · next-action-banner.tsx:44 (60s) · teacher-session-card.tsx:76 (60s).
**RPCs:** `get_teacher_overdue_eval_count`.

### C. Visual structure
**Outermost containers:**
- page.tsx:189 — `<main>` (no classes — relies on layout)
- dashboard-content.tsx:163 — `<div dir={dir} className="mx-auto max-w-7xl px-4 py-8 sm:px-6" id="teacher-main">`
- Streamed wrappers (page.tsx:226, 232, 238, 244, 251) — `mx-auto max-w-6xl px-4 pb-2 sm:px-6` ⚠️ **width mismatch with main: max-w-7xl vs max-w-6xl**

**Render order:** `DataLoadBanner` → `TeacherWelcomeHeader` → `TeacherNextActionBanner` → `TeacherGuidanceBanner` → `TeacherActionQueue` (CV approved only) → 4× `StatInline` → time-to-grade discipline section → `WidgetCard`+`AnalyticsChart` | `LiveSessionsWidget`+`BreakdownBar` → `DataTable` (Recent students) → today's sessions (`TeacherSessionCard` list) + `TeacherQuickActions` → pending bookings table → footer → streamed: `TalqeenInboxCard`, `RosterErrorPulse`, `ParentReportDigestCard`, `RecitationStandardRoster` → `TeacherAtRiskStudents` → `MentorshipCard`.

**glass-card consistency:** Good — top-level surfaces use `glass-card`. Outlier: `mentorship-card.tsx:64` uses `rounded-2xl border border-card-border bg-card p-5` instead.

**Empty states:** Mostly friendly. **`return null` (silent disappearance)** in `at-risk-students.tsx:44, :55`, `mentorship-card.tsx:32`, `recitation-standard-roster.tsx:40`.

**Skeletons:** `loading.tsx` covers initial paint; streamed widgets each export a `*Skeleton`. **No skeleton** for `at-risk-students` or `mentorship-card`.

**Status badges/icons:** time-to-grade badge — color-only (dashboard-content.tsx:268). CV pill — color-only (welcome-header.tsx:108). Mentorship severity pill — color-only (mentorship-card.tsx:122). Risk-score badge — no icon. **a11y risk: 4 color-only signals.**

### D. RTL / i18n
- **Hardcoded English in JSX:** none.
- **Hardcoded Arabic without `t()`:** at-risk-students.tsx:21-23 (`اليوم`/`أمس`/`قبل ${d} يوم`), :63 (`بدون اسم`), :69 (`طلاب يحتاجون انتباهاً`), :100 (`اعرض تقدمهم...`); actions.ts:183 (`toLocaleDateString("ar")` in error msg).
- **`text-left|text-right|ml-*|mr-*|pl-*|pr-*`:** **0 occurrences** ✅.
- **Hardcoded `toLocaleDateString("en-US")` / `("ar")`:** mentorship-card.tsx:79, :80 (Arabic branch shows English-formatted date), :120 (feedback timestamp); actions.ts:183 (server-side hardcoded `"ar"`).
- **Server-side `setHours(0,0,0,0)` issue:** page.tsx:35-37 — runs in **UTC on Vercel** (matches `feedback_timezone_in_date_rendering` memory). "Today's sessions" boundary drifts for non-UTC users.
- **Directional icons:** next-action-banner.tsx:35 correctly flips `Arrow = dir === "rtl" ? ArrowLeft : ArrowRight`. talqeen-inbox-card.tsx:109 + roster-error-pulse.tsx:80 use `ArrowRight` with `rotate-180` when ar — works but inconsistent.

### E. Known bugs / smells
- **`actions.ts` has 7 server actions, none wrapped in `loudAction`** (lines 12, 202, 255, 338, 389, 451, 493) — violates CLAUDE.md "No Silent Failures" policy.
- **Container width mismatch** — main `max-w-7xl` vs streamed sections `max-w-6xl` (5 occurrences). Visible alignment jog as widgets stream in.
- **UTC date boundary** on `todayStart/todayEnd` (page.tsx:35-36).
- **Unbounded queries** — page.tsx:66, :69; at-risk-students.tsx:36 (90d, no `.limit()`).
- **`as never` casts on RPC** (page.tsx:101-103) — fragile chain pending types regen.
- **`mentorship-card.tsx`** — hardcoded `"en-US"` even in Arabic mode; query is unbounded (relies on RLS).
- **localStorage SSR-skip flash** — next-action-banner.tsx:38-41 returns null then re-renders post-mount.
- **No Suspense around `MentorshipCard`** — its 3 sequential queries block the page tail.
- **Color-only status indicators** in 4 places (see C).

### F. Quick wins ranked
1. **Wrap `actions.ts` in `loudAction`** — 7 functions across actions.ts:12-493. ~45 min, biggest impact (silent-fail policy).
2. **Fix container width mismatch** — page.tsx:226, 232, 238, 244, 251 from `max-w-6xl` → `max-w-7xl`. ~5 min.
3. **i18n `at-risk-students.tsx`** — wrap strings at :21-23, 63, 69, 100 in `getT()` (server pattern, see mentorship-card.tsx:17). ~15 min.
4. **Locale-correct dates in `mentorship-card.tsx`** — replace `"en-US"` at :79, :80, :120 with `lang === "ar" ? "ar" : "en-US"`. ~5 min.
5. **Wrap `<MentorshipCard>` in Suspense** — page.tsx:274; mirror `TalqeenInboxCardSkeleton`. ~10 min.

---

## 3. Admin Dashboard

### A. File inventory
- `src/app/admin/dashboard/page.tsx` — 127 lines (server component)
- `src/app/admin/dashboard/dashboard-content.tsx` — 368 lines (client, `"use client"`)
- `welcome-header.tsx` — 65 lines (client) · `next-action-banner.tsx` — 207 lines (client)
- `archive-toggle.tsx` — 143 lines (client) · `cache-clear-button.tsx` — 55 lines (client)
- `actions.ts` — 58 lines (server actions)
- `src/lib/dashboard-queries.ts` — 5 helper queries (admin block, lines 1223-1452)
- `loading.tsx` — yes, 127 lines · `error.tsx` — none in `dashboard/`; falls through to `src/app/admin/error.tsx` (52L)
- Role layout: `src/app/admin/layout.tsx` — 13 lines (`requireAdmin()` + `<DashboardLayout role="admin">`)

### B. Data layer
All 14 reads in **one** `Promise.all` fan-out at page.tsx:54-84, each wrapped in `withTimeout(..., 5000ms)`. **Round-trip count: 14 in `page.tsx` + 1 sequential `fetchNameMap` (page.tsx:98) = 15 base.** No `select("*")`. No RPCs, no DB views, no Realtime.

Inline queries (`page.tsx`):
| Line | Table | Cols | Filter |
|------|-------|------|--------|
| 70 | profiles | `id` (count head) | role=student |
| 71 | teacher_profiles | `teacher_id, hourly_rate, rating_avg, total_sessions, is_accepting, is_archived` | order; **unbounded list** |
| 72 | bookings | `id` (count head) | created_at ≥ startOfMonth |
| 73 | bookings | `amount_usd` | status=completed, ≥startOfMonth — **unbounded sum-on-client** |
| 74 | bookings | `id` (count head) | status=pending |
| 75 | bookings | `id, student_id, teacher_id, scheduled_at, session_type, created_at` | status=pending, limit 5 |
| 76 | profiles | `id` (count head) | role=student, ≥7d |
| 77 | bookings | `id, student_id, teacher_id, scheduled_at, session_type, status, duration_min` | today — **unbounded** |
| 78 | sessions | `id` (count head) | started_at not null, ended_at null |

Helper queries (`src/lib/dashboard-queries.ts`):
- L1238-1252 `getAdminMonthlyRevenueTrend`: 2× `bookings.amount_usd` (curr/prev month) — internal Promise.all
- L1273 `getAdminDailyRevenue`: bookings 7d, sums in JS — **unbounded**
- L1330 `getAdminLiveSessions`: sessions w/ FK embed `booking:bookings!sessions_booking_id_fkey(...)` 4h window
- L1384 `getAdminBookingStatusBreakdown`: bookings.status 30d, counts in JS — **unbounded**
- L1423 `getAdminRecentBookings`: bookings + embed `student:profiles!student_id(full_name)` limit 6

True total when revenue helper runs: **15 + 1 inner Promise.all = 16**. No caching layer (no `unstable_cache`, no Cache Components).

**Polling intervals (client):** dashboard-content.tsx:63 (60s clock) · next-action-banner.tsx:37 (60s tick).
**Realtime:** none.

### C. Visual structure
**Outermost (dashboard-content.tsx):**
- L120 hairline: `h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0`
- L121 main wrap: `mx-auto max-w-7xl px-4 py-8 sm:px-6` (note: **`loading.tsx:7` uses `max-w-6xl` — mismatch**)
- L141 stat grid: `grid grid-cols-2 gap-4 md:grid-cols-4 stagger-children motion-reduce:[&>*]:animate-none`
- L166 analytics grid: `mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5` (3+2 split)
- L204 today/quick-actions: same 5-col split

**Render order:** `AdminWelcomeHeader` → `AdminNextActionBanner` → 4× `StatCard` → `WidgetCard(AnalyticsChart Daily Revenue)` + `LiveSessionsWidget` + `BreakdownBar` → `DataTable Recent Bookings` → `WidgetCard Today's Activity` + Quick Actions glass-card → `WidgetCard Teacher Management (table + ArchiveToggle)` → optional new-students CTA → footer.

**glass:** `WidgetCard` and `glass-card` (L240, banner `glass`/`glass-gold`) used consistently. Quick Actions block (L240) is a raw `glass-card` instead of `WidgetCard` — minor inconsistency.

**Empty states:** Explicit & friendly — Today (L208-214), Teachers (L274-280), `BreakdownBar emptyMessage` (L179), `DataTable emptyMessage` (L198).

**Skeletons:** `loading.tsx` comprehensive, **but RTL hard-coded `dir="rtl"` (L7)** — ignores English locale.

**Status badges:** Welcome-header has icons (Radio L44, Activity L52, AlertTriangle L57). Today's-activity per-row badge **no icon** (dashboard-content.tsx:227-229). Teacher status pills (L303-305) **no icon** — color-only.

### D. RTL / i18n
- **Hardcoded English in JSX:** none outside `t(ar, en)` second arg.
- **Hardcoded Arabic without `t()`:** archive-toggle.tsx:64 (`هل أنت متأكد...`), :74, :82, :107, :119, :131, :138; actions.ts:15 (`ليس لديك صلاحية`), :36 (`حدث خطأ...`). ≈10 instances total in archive-toggle + actions.
- **`text-left|text-right|ml-*|mr-*|pl-*|pr-*`:** **0 occurrences** ✅. Uses logical `text-start`, `text-end`, `ms-1`, `end-2`.
- **`toLocaleDateString` / `toLocaleTimeString`:** dashboard-content.tsx:57, :66, :108 all locale-aware ✅. **`src/lib/dashboard-queries.ts:1437` `toLocaleDateString("en-US", ...)`** — hardcoded en-US in `getAdminRecentBookings`.
- **Directional icons:** next-action-banner.tsx:6,28 correctly flips `ArrowLeft`/`ArrowRight` based on `dir` ✅.
- `loading.tsx:7` hardcodes `dir="rtl"` — flickers wrong direction for English admins on first paint.

### E. Known bugs / smells
- **`loading.tsx` hardcodes `dir="rtl"` and `max-w-6xl`** while page uses `max-w-7xl` and dynamic `dir` → layout shift on hydration.
- **Unbounded queries** (page.tsx:71, 73, 77; helpers L1273, L1384). Sums computed in JS.
- **Sequential `fetchNameMap`** (page.tsx:98) waits for the fan-out — could be inlined per-result like other helpers do.
- archive-toggle.tsx:51 `setTimeout` without cleanup — fires after unmount.
- archive-toggle.tsx:30 calls server action then **silently no-ops** on `result.error` (no toast/banner on failure).
- `actions.ts:8 toggleArchiveTeacher` — has `requireAdmin` ✅; **does NOT use `loudAction`** (CLAUDE.md "No Silent Failures").
- dashboard-content.tsx:84 `window.location.assign` for shortcut nav (full reload) instead of `router.push`.
- `BOOKING_STATUS_COLORS` (dashboard-queries.ts:1368) labels are **English-only** ("Completed", "Pending"…) — BreakdownBar shows English in Arabic mode.
- `getAdminRecentBookings` returns `view: "view"` magic string (L1451).

### F. Quick wins ranked
1. **`src/lib/dashboard-queries.ts:1437` — replace `toLocaleDateString("en-US", …)` with locale-aware formatting on the client.** Pass raw ISO through; format in `DataTable` using `useLang` locale. ~15 min. (i18n correctness.)
2. **`src/lib/dashboard-queries.ts:1370-1374` — translate `BOOKING_STATUS_COLORS` labels via `t()` on the client** (move label out of server, keep color server-side). ~15 min. (Visible Arabic mismatch in BreakdownBar.)
3. **`src/app/admin/dashboard/loading.tsx:7` — drop hardcoded `dir="rtl"` + bump `max-w-6xl` → `max-w-7xl`** to match the rendered page. ~5 min. (Eliminates hydration jump.)
4. **`dashboard-content.tsx:227, 303-305` — add icons to status badges** (Confirmed/Pending/Open/Busy/Archived). Reuse a `StatusPill` like welcome-header. ~20 min. (a11y P1.)
5. **`page.tsx:73, 77 + dashboard-queries.ts:1273, 1384` — replace client-side sums with Postgres aggregates** (RPC or `select sum()`). ~45-60 min. (Highest impact at scale.)

---

## 4. Moderator Dashboard

### A. File inventory
- `src/app/moderator/dashboard/page.tsx` — **62 lines** (server component)
- `src/app/moderator/dashboard/dashboard-content.tsx` — **398 lines** (`"use client"`)
- `src/app/moderator/dashboard/at-risk-students.tsx` — **74 lines** (server component)
- `src/app/moderator/dashboard/loading.tsx` — **95 lines** ✅ present
- `error.tsx` sibling — **none** (route covered by `src/app/moderator/error.tsx`, 1726 bytes)
- Role layout — `src/app/moderator/layout.tsx` (5 lines, `<DashboardLayout role="moderator">`)
- Shared imports: `StatCard`, `WidgetCard`, `AnalyticsChart`, `LiveSessionsWidget`, `BreakdownBar`, `DataTable`, `ShortcutsHelp`, `SectionErrorBoundary`, `Skeleton`, `useToast`, `useKeyboardShortcuts`

### B. Data layer
**page.tsx Promise.all #1 — 5 round-trips, all `count: "exact", head: true`:**
- L27: `profiles` count where `role=student`
- L28: `profiles` count where `role=teacher`
- L29: `teacher_profiles` count where `cv_status=pending_review`
- L30: `sessions` count where `started_at IS NOT NULL AND ended_at IS NULL`
- L31: `session_evaluations` count (**unbounded — all-time**)

**page.tsx Promise.all #2 — 4 helper calls (5 underlying RTs):**
- L35 `getModeratorWeeklyCVActivity()` → `teacher_profiles.select("cv_submitted_at")` 7d (dashboard-queries.ts:1467)
- L36 `getAdminLiveSessions()` → sessions w/ embed `booking:bookings!sessions_booking_id_fkey(...student/teacher)` 4h (dashboard-queries.ts:1330) — *shared with admin dashboard*
- L37 `getModeratorRatingDistribution()` → `session_evaluations.select("overall_score")` 30d (dashboard-queries.ts:1514)
- L38 `getModeratorFlaggedEvaluations()` → **2 RTs**: `session_evaluations` + `profiles` (dashboard-queries.ts:1548, 1572)

**`at-risk-students.tsx` — 2 sequential RTs, OUTSIDE the Promise.all:**
- L22: `retention_signals` (student_id, churn_risk_score, last_session_at), score≥60, top 5
- L32: `profiles.select("id, full_name") .in("id", signals.map(...))`

**Total round-trips per render: 12** (5 counts + 5 in helper batch + 2 sequential at-risk).
No `select("*")`. No RPCs. No views.
**Polling:** `setInterval(60_000)` at dashboard-content.tsx:48 — only updates client clock.
**Realtime:** none.

### C. Visual structure
**Outermost (page.tsx wraps with `<>`):**
- Hairline divider: `h-0.5 bg-gradient-to-l from-gold/0 via-gold/30 to-gold/0` (L118)
- Main: `mx-auto max-w-7xl px-4 py-8 sm:px-6` (L119) — **note: `loading.tsx:7` uses `max-w-6xl` ⚠️ width mismatch**
- At-risk wrapper: `mx-auto max-w-6xl px-4 pb-8 sm:px-6` (page.tsx L57) — also `max-w-6xl`, mismatched with main `max-w-7xl`

**Render order:** Skip-link → divider → header (h1 + weekday) → smart banner (4 priority cascades, dismissible) → 4× `StatCard` (`grid grid-cols-2 gap-4 md:grid-cols-4 stagger-children`) → `WidgetCard` + `AnalyticsChart` (CV Submissions Activity, 3/5 cols) → `LiveSessionsWidget` + `BreakdownBar` (Rating Distribution, 2/5 cols) → `DataTable` (Flagged Evaluations Last 7 Days) → `WidgetCard` Quick Actions → footer → **separate max-width container:** `<ModeratorAtRiskStudents />`.

`glass-card` / `glass-gold` / `glass-pill` consistent.
**Empty states:** `BreakdownBar emptyMessage` (L257); `DataTable emptyMessage` (L276); `LiveSessionsWidget` count badge; **`AtRiskStudents return null` if no signals (L30) — silent disappearance.**
**Skeleton:** covers stats/chart/right widgets/table/quick-actions but **not the banner or at-risk widget** — and uses `max-w-6xl` while page uses `max-w-7xl`.
**Status badges:** `StatCard.statusBadge` props ("عاجل"/"مباشر"/"للمراجعة") delegate to component; banner icons present (FileCheck, Star, Video, ShieldCheck).

### D. RTL / i18n
- **Hardcoded English strings:** none — all wrapped in `t()`.
- **Hardcoded Arabic without `t()`:**
  - at-risk-students.tsx:9-11 (`اليوم` / `أمس` / `قبل ${d} يوم`) (relative-time, no English)
  - at-risk-students.tsx:38 (`بدون اسم`), :45 (`طلاب في خطر التسرب`), :48 (`عرض الكل ←` — link + literal arrow), :67 (`آخر جلسة:`)
  - page.tsx:13 metadata `title: "لوحة المشرف"` (no English fallback — affects browser tab in en mode)
- **Directional spacing:** **0 occurrences** of `text-left|text-right|ml-N|mr-N|pl-N|pr-N` ✅. Uses logical `start-/end-/ms-/me-`.
- **`toLocaleDateString("en-US")`:** dashboard-queries.ts:1588 (returned to flaggedEvaluations table, **always en-US regardless of lang**) — bleeds into this dashboard's DataTable. (dashboard-content.tsx:51 uses dynamic `locale` ✅.)
- **Directional icons:** at-risk-students.tsx:6 + :40 — `const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight` ✅. **at-risk-students.tsx:48 uses literal `"←"` arrow — not dir-aware**; renders mirrored in LTR.

### E. Known bugs / smells
- **`max-w-6xl` vs `max-w-7xl` mismatch** between page.tsx:57+119 and loading.tsx:7 → layout shift on first paint.
- **`ModeratorAtRiskStudents` rendered outside `Promise.all`** → 2 extra sequential RTs after parallel batch.
- **page.tsx:31 unbounded all-time `session_evaluations` count** — grows linearly forever.
- at-risk-students.tsx — comment at :15-18 claims it's gated by route protection; widget itself does no role check.
- **at-risk-students.tsx:30 `return null` on empty data** → silent disappearance.
- dashboard-queries.ts:1588 `toLocaleDateString("en-US")` — date column wrong locale in Arabic; UTC vs client mismatch (per `feedback_timezone_in_date_rendering`).
- No `as never` casts; no server actions in this dashboard (read-only).
- `flaggedEvaluations` typed as `{ id: string; [key: string]: unknown }[]` (page.tsx :33, :275) — loses field-level types.
- `dashboardData` shape redefined inline at dashboard-content.tsx:23-34 — duplicates helper return types.

### F. Quick wins ranked
1. **Move `ModeratorAtRiskStudents` queries into the page-level `Promise.all`** (page.tsx :34-39 + :57-59). Saves ~80-150 ms by parallelising the 2 retention RTs with the existing 5. ~10 min.
2. **Bound the all-time eval count** at page.tsx:31 to last 90 days (`.gte("created_at", ninetyDaysAgo)`). ~5 min.
3. **Fix `max-w-6xl`/`max-w-7xl` mismatch** — change loading.tsx:7 to `max-w-7xl` and lift `ModeratorAtRiskStudents` inside main wrapper (or change page.tsx:57). ~3 min.
4. **Replace `return null` with empty state** in at-risk-students.tsx:30 — render a small "no at-risk students" glass-card. ~5 min.
5. **Fix `toLocaleDateString("en-US")` at dashboard-queries.ts:1588** — accept a locale arg; pass `lang` from helper. ~10 min.

---

## Cross-dashboard summary

### Shared components used by 2+ dashboards (leverage points)
| Component | Used by | Notes |
|-----------|---------|-------|
| `StatCard` | all 4 | Status badges are color-only on student/admin/teacher — fixing once gates a11y for everyone. |
| `WidgetCard` | all 4 | Generic glass shell — currently the right primitive; admin's Quick-Actions uses raw `glass-card` instead, drift risk. |
| `AnalyticsChart` | all 4 | Receives pre-aggregated points; sums currently happen in JS for admin (page.tsx + helpers). |
| `LiveSessionsWidget` | all 4 | All routes call `getAdminLiveSessions` (admin dashboard, moderator dashboard) or a role-shaped equivalent — same FK embed. |
| `BreakdownBar` | all 4 | Honors `emptyMessage`. Admin label-source is English-only; fixing `BOOKING_STATUS_COLORS` ripples. |
| `DataTable` | all 4 | Honors `emptyMessage`; receives pre-formatted rows, so any `toLocaleDateString("en-US")` upstream bleeds in. |
| `dashboard-queries.ts` | all 4 | Single ~1600-line file; admin block 1223-1452, moderator 1467-1596, teacher/student helpers earlier. The hardcoded `"en-US"` formatters live here — one fix, four routes. |
| `ShortcutsHelp` + `useKeyboardShortcuts` | moderator + others | Footer shortcut row is a copy-paste pattern across roles. |
| `SectionErrorBoundary` | student, moderator | Not adopted in admin/teacher — uneven resilience. |
| `Skeleton` (card-shell) | moderator, teacher | Inline patterns vary; could be a single primitive. |

### Patterns that should be extracted
1. **`useNowTicker(intervalMs = 60_000)` hook.** Currently student spawns 2 timers, teacher spawns 3, admin 2, moderator 1. Eight independent intervals doing the same job. One hook, one timer, one re-render per minute per page.
2. **Locale-aware date helper** (`formatDate(iso, lang)`) called server-side from `dashboard-queries.ts`. Replaces 4 hardcoded `"en-US"` / `"ar"` instances (admin :1437, teacher mentorship-card.tsx :79/:80/:120, moderator :1588) with one source of truth.
3. **Status-pill primitive with icon slot** — color-only badges are the dominant a11y bug across admin (2 sites), teacher (4 sites), and student (KPI badges). One `StatusPill({ tone, icon, label })` covers them all.
4. **`EmptyCard` server component** — 5 of the 16 self-fetching child widgets do `return null` on empty (teacher × 4, moderator × 1). One `<EmptyCard variant="quiet" />` keeps the layout slot stable.
5. **Width-mismatch fix as a layout convention.** `loading.tsx` files for **admin** and **moderator** both use `max-w-6xl` while the rendered pages use `max-w-7xl`. Teacher has the same problem in streamed-section wrappers. Picking one width and codifying it in `<DashboardLayout>` removes 3 layout shifts at once.
6. **`loudAction` adoption** — admin actions.ts (toggleArchiveTeacher) and teacher actions.ts (7 functions) both bypass the policy. One sweep across both files closes the silent-fail gap on dashboards.

### Recommended order
1. **Moderator first** (smallest surface — page 62L + content 398L + at-risk 74L). Few queries (12 RTs), narrow scope, the cleanest place to land patterns 1–5 above. Risk is low; if a shared abstraction goes wrong it only affects this one dashboard.
2. **Student second.** Largest user impact, but already the most i18n-clean (0 hardcoded strings, 0 directional class violations). The big lift is the unbounded homework query and 3 sequential follow-on RTs — both are localized to `page.tsx`. Use the patterns proven in moderator.
3. **Admin third.** Heaviest data layer (16 RTs, 5 unbounded queries, JS-side sums). Needs the deepest perf investment (Postgres aggregates) — best done after the cosmetic patterns are stable so the perf work isn't entangled with theming churn.
4. **Teacher last.** Largest code surface (~3000+ lines across 16 files), most server actions to wrap with `loud()`, most streamed Suspense components — touches the most files per change, so do it once the shared primitives are battle-tested.

This ordering preserves a clean ratchet: each dashboard inherits the patterns proven on the previous one, and the highest-leverage architectural work (Postgres aggregates, `loudAction` sweep) lands once the visual primitives are stable.
