# FURQAN Academy — Implementation Roadmap

> Audit-driven hardening plan. Organized into 8 sprints across 4 priority tiers.
> Based on: AUDIT.md recommendations + completed Phases A–I.
> Date: 2026-04-10

---

## Guiding Principle

**The next phase is hardening, not feature expansion.**

The platform already has enough product surface. The biggest win now is making it:
- Easier to **operate** (automation, control tower, compliance)
- Easier to **monetize** (Stripe, renewals, conversion)
- Easier to **trust** (parent communication, delivery tracking)
- Easier to **scale** (domain ownership, event contracts, lifecycle docs)

---

## Sprint 1: Stripe Payment Completion [P1-CRITICAL]

> **Status:** DB-side scaffolded (Phase 15, 2026-04-23). Final SDK integration blocked until Stripe test-mode keys arrive.
> **Impact:** Closes the #1 audit gap — revenue/payment readiness (C+ → A-)
> **Estimated effort:** originally 1 session; now ~15 min once keys arrive (install `stripe`, uncomment sig verification, set env vars)
> **Remaining work:** install `stripe` package, uncomment signature verification block in `src/app/api/stripe/webhook/route.ts`, add checkout creation route, wire `currency-packages.tsx` buttons. All DB logic (fulfillment, refund, payment/invoice/package creation) lives in `src/lib/stripe/*` and is unit-callable today.

### What to build

| Task | File | Details |
|------|------|---------|
| Stripe server client | `src/lib/stripe/server.ts` | Lazy-init Stripe instance with STRIPE_SECRET_KEY |
| Stripe browser client | `src/lib/stripe/client.ts` | loadStripe with NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY |
| Checkout API route | `src/app/api/stripe/checkout/route.ts` | Create Checkout Session, insert pending payment |
| Webhook handler | `src/app/api/stripe/webhook/route.ts` | Replace stub: verify signature, handle checkout.session.completed/expired |
| Package fulfillment | Inside webhook | Create student_package + student_credits + payment_transaction + invoice |
| Purchase action | `src/app/student/packages/actions.ts` | Server action returning checkout URL |
| Public packages | `src/app/(public)/packages/currency-packages.tsx` | Replace "Book Now" link with checkout button |
| Booking flow | `src/app/student/bookings/new/actions.ts` | Deduct from package via deduct_package_session() RPC |

### Entitlement rules to define

| Scenario | Rule |
|----------|------|
| Session booked | Deduct 1 from student_package.sessions_used (atomic) |
| Booking cancelled by student | Refund 1 session to package |
| No-show (student fault) | Session consumed, no refund |
| No-show (teacher fault) | Refund 1 session + admin notified |
| Package expired | Status → 'expired', remaining sessions lost (or configurable) |

### Env vars needed
```
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Verification
- Test purchase in Stripe test mode → verify student_package created
- Test webhook with `stripe listen --forward-to localhost:3000/api/stripe/webhook`
- Verify invoice record created
- Verify booking deducts from package

---

## Sprint 2: Communication Infrastructure [P1] ✅ SHIPPED

> **Status:** Done. `message_delivery_log` + `communication_preferences` tables live; `dispatchNotification()` dispatcher is the canonical notification path and is used by all retention interventions and parent reports.
> **Impact:** Enables reliable multi-channel messaging, parent trust, delivery tracking
> **Estimated effort:** 1 session

### New migration: `v13_001_communication.sql`

**Table: `message_delivery_log`**
```sql
id, recipient_user_id, recipient_channel (in_app|email|whatsapp|telegram|sms),
template_name, related_entity_type, related_entity_id,
status (pending|sent|delivered|failed), provider_message_id,
attempted_at, delivered_at, failed_at, failure_reason, created_at
```

**Table: `communication_preferences`**
```sql
id, user_id (FK profiles), preferred_language (ar|en|bilingual),
email_enabled (default true), whatsapp_enabled (default true),
in_app_enabled (default true), quiet_hours_start, quiet_hours_end,
important_only_mode (default false), created_at, updated_at
```

### Notification dispatcher

**Create:** `src/lib/notifications/dispatcher.ts`

```typescript
interface SendOptions {
  userId: string;
  type: NotifType;
  title: string;
  body: string;
  channels?: ("in_app" | "email" | "whatsapp")[];
  entityType?: string;
  entityId?: string;
  templateName?: string;
}

async function dispatchNotification(opts: SendOptions): Promise<void>
```

Logic:
1. Fetch user's communication_preferences
2. Respect quiet hours and channel preferences
3. Send via each enabled channel (in_app always, email if enabled, whatsapp if enabled)
4. Log each delivery attempt in message_delivery_log
5. Non-blocking, fire-and-forget pattern

### Migrate existing notification calls
Replace direct `supabase.from("notifications").insert(...)` calls with `dispatchNotification()` in:
- `src/lib/actions/homework.ts` (6 places)
- `src/lib/actions/evaluations.ts` (3 places)
- `src/app/teacher/dashboard/actions.ts` (8 places)
- `src/app/student/bookings/new/actions.ts` (1 place)
- `src/components/shared/message-actions.ts` (1 place)

### Verification
- New tables exist in Supabase
- Notification sends are logged in message_delivery_log
- User preferences respected (test with quiet hours)

---

## Sprint 3: Event Contracts + Lifecycle Docs [P1] ✅ SHIPPED

> **Status:** `EVENT_CATALOG.md` + `LIFECYCLES.md` exist and are kept in sync with emit.ts.
> **Impact:** Reduces logic sprawl risk, makes system predictable
> **Estimated effort:** Documentation only, no code changes

### Create: `EVENT_CATALOG.md`

For each event, document:
| Event | Trigger Point | Source File | Payload | Subscribers | Side Effects |
|-------|--------------|-------------|---------|-------------|--------------|
| booking.created | Student creates booking | student/bookings/new/actions.ts | student_id, teacher_id, session_type, scheduled_at | n8n: reminder engine, admin digest | Teacher notification |
| booking.confirmed | Teacher confirms | teacher/dashboard/actions.ts | student_id, teacher_id | n8n: room creation, reminder scheduling | Student notification, room created |
| ... | ... | ... | ... | ... | ... |

### Create: `LIFECYCLES.md`

Document state machines for:

**Booking lifecycle:**
```
pending → confirmed → completed
           ↓
         cancelled / no_show
```

**Session lifecycle:**
```
created → started → ended
```

**Follow-up lifecycle:**
```
assigned → student_ready → completed_* (with auto-regeneration branch)
```

**Package lifecycle:**
```
purchased → active (sessions deducted) → expired / cancelled
```

**Evaluation lifecycle:**
```
created → reviewed by student (read-only)
```

### Verification
- Documents are accurate against current code
- No undocumented state transitions exist

---

## Sprint 4: Dashboard UX Hardening [P2] ✅ SHIPPED

> **Status:** Teacher action queue live; admin control tower live with 7 widgets + at-risk widget (Phase 9).
> **Impact:** Shifts dashboards from data-heavy to action-oriented
> **Estimated effort:** 1 session

### Student dashboard changes
- Reorder widgets: **next session → follow-up due → package remaining → progress**
- Add "primary action" CTA based on state:
  - Has follow-up due? → "Go to follow-up"
  - No upcoming session? → "Book a session"
  - Package low? → "Renew package"

### Teacher dashboard changes
**Create:** `src/app/teacher/dashboard/action-queue.tsx`
- Single component showing prioritized action items:
  - Students awaiting grading (follow-up status=student_ready)
  - Overdue evaluations
  - Unread messages
  - Low availability warnings
- Replace guidance banner for approved teachers with action queue

### Admin dashboard changes
- Add control tower summary widget:
  - Pending CV reviews count
  - Failed automations (last 24h)
  - Missed sessions today
  - Low-balance packages count
  - New signups (last 7 days)

### Verification
- Each dashboard shows the most important action first
- No important state is buried below the fold

---

## Sprint 5: Retention Engine [P2] ✅ SHIPPED (app-side)

> **Status:** App-side DONE across 7 phases (9, 10, 11, 12, 13, 14, 18, 19, 20). `retention_signals` table live; scorer endpoint at `/api/retention/score`; admin page + filters + intervention buttons + cooldown + history; teacher + moderator widgets; session-page risk hints; manual trigger button. Remaining: n8n daily cron on Mac mini → POST to /api/retention/score with X-N8N-Secret header.
> **Impact:** Reduces churn, increases renewal rates
> **Estimated effort:** 1 session (DB + types) + Mac-mini n8n session (cron + intervention workflow subscribers)

### New migration: `v13_002_retention.sql`

**Table: `retention_signals`**
```sql
id, student_id (FK profiles),
last_booking_at, last_session_at, last_login_at,
package_remaining (integer), package_expires_at,
engagement_score (numeric), churn_risk_score (numeric),
last_intervention_at, intervention_type,
computed_at (timestamptz), created_at
```

### Churn risk signals

| Signal | Weight | Source |
|--------|--------|--------|
| No booking in 14 days | High | bookings table |
| Repeated no-show (3+) | High | bookings.status = no_show |
| Falling follow-up completion | Medium | homework_assignments completed_needs_work/not_done |
| Package expired without renewal | Critical | student_packages.status = expired |
| No login in 7 days | Medium | profiles.updated_at or auth |
| Cancellation rate > 30% | High | bookings.status = cancelled |

### n8n workflows to build (VPS session)
- **Daily retention scorer** — scans students, computes scores, inserts to retention_signals
- **Package exhaustion alert** — notify when ≤2 sessions left
- **Package expiry countdown** — 7/3/1 day reminders
- **Inactive re-engagement** — message after 14 days no activity
- **Trial-to-paid nudge** — 3-message sequence after first session

### Verification
- retention_signals populated by n8n daily scan
- Alerts sent for low-balance and expiring packages
- Inactive students receive re-engagement messages

---

## Sprint 6: Teacher Compliance & Quality [P2] ✅ SHIPPED (app-side)

> **Status:** Teacher action queue live. 90-day health metrics card on `/admin/teachers/[id]` (punctuality, grading lag, eval completion, no-show rate). Remaining: n8n grading-follow-up and eval-compliance workflows on Mac mini.
> **Impact:** Improves teacher consistency, surfaces issues early
> **Estimated effort:** 1 session

### Teacher action queue (code)
**Create:** `src/app/teacher/dashboard/action-queue.tsx`
- Pending follow-up to grade (count + links)
- Overdue evaluations (students with >4 sessions since last eval)
- Unread student messages
- Upcoming sessions today

### Teacher health metrics (admin view)
**Enhance:** `src/app/admin/teachers/[id]/page.tsx`
- Add metrics section: punctuality, grading lag, evaluation completion rate, no-show rate
- Query from bookings + homework_assignments + session_evaluations

### n8n workflows (VPS session)
- **Grading follow-up** — follow-up in student_ready > 48h → remind teacher
- **Evaluation compliance** — >4 sessions without evaluation → prompt teacher + admin
- **Weekly teacher snapshot** — summary to each teacher + admin overview

### Verification
- Teacher sees action queue with real data
- Admin sees teacher health metrics
- n8n sends grading/evaluation reminders

---

## Sprint 7: Admin Control Tower [P3] ✅ SHIPPED

> **Status:** Live at `/admin/control-tower` with 8 widgets including at-risk students. Per-widget alert thresholds + linking to filtered pages.
> **Impact:** Gives admins operational visibility and exception management
> **Estimated effort:** 1 session

### Create: `src/app/admin/control-tower/page.tsx`

Control tower showing at a glance:

| Widget | Data Source | Alert Threshold |
|--------|-----------|-----------------|
| Pending CV reviews | teacher_profiles.cv_status = pending_review | Any |
| Failed automations (24h) | automation_logs.status = failed | > 0 |
| Missed sessions today | bookings.status = no_show, today | Any |
| Low-balance packages | student_packages: remaining ≤ 2 | > 0 |
| Expiring packages (7 days) | student_packages.expires_at < now+7d | > 0 |
| New signups (7 days) | profiles.created_at > now-7d | Info |
| Overdue teacher grading | homework: student_ready > 48h | > 0 |
| Unresolved recitation errors | recitation_errors.resolved = false | > 10 |

### Exception queues
Each widget links to a filtered list page where admin can take action.

### Add to admin nav
```typescript
{ href: "/admin/control-tower", ar: "مركز التحكم", en: "Control Tower", icon: Activity }
```

### Verification
- Control tower shows real data from all sources
- Each metric links to actionable page
- Zero-state handled gracefully

---

## Sprint 8: AI & Advanced Features [P4]

> **Status:** Template path scaffolded (Phases 16, 17, 19). `buildSessionNarrative` generates structured reports today; `sendSessionNarrative` dispatches + writes parent_reports + is idempotent. POST `/api/reports/session/[id]/send` accepts optional `narrative_paragraph` override for n8n's AI path. Remaining: Anthropic key + n8n workflow that generates the paragraph with Claude and POSTs with the override.
> **Impact:** Differentiation, premium experience
> **Estimated effort:** Multiple sessions, requires Anthropic API key

### AI Parent Narratives (n8n workflow)
- Trigger: session.notes_saved
- Fetch rich context (session, follow-up, evaluation, progress)
- Claude API generates warm Arabic summary
- Fallback to structured template if AI fails
- Send via dispatcher (email/WhatsApp/in-app)
- Save to parent_reports

### AI Curriculum Advisor (n8n workflow)
- Weekly scan of recitation_errors + follow-up outcomes
- Identify patterns (e.g., "student struggles with makharij in surah 2")
- Generate teaching suggestions for teacher dashboard

### Teacher Matching (future)
- Score teachers by: availability, language, gender preference, level, timezone, specialties
- Recommend to new students

### Parent Self-Service Chatbot (future)
- WhatsApp inbound → query student progress → respond in Arabic
- Read-only, no state mutations

### Verification
- AI reports generate correctly with sample data
- Fallback works when AI unavailable
- Reports are warm, accurate, Arabic, parent-safe

---

## Sprint Dependencies

```
Sprint 1 (Stripe) ──────────── blocked on API keys
Sprint 2 (Communication) ───── no blockers
Sprint 3 (Event Docs) ──────── no blockers (docs only)
Sprint 4 (Dashboard UX) ────── no blockers
Sprint 5 (Retention) ────────── depends on Sprint 2 (dispatcher)
Sprint 6 (Teacher Quality) ──── no blockers
Sprint 7 (Control Tower) ────── benefits from Sprints 5+6 data
Sprint 8 (AI) ───────────────── depends on Anthropic API key + Sprint 2
```

**Recommended order (considering blockers):**
1. Sprint 2 (Communication) — no blockers, enables 5+8
2. Sprint 3 (Event Docs) — documentation only
3. Sprint 4 (Dashboard UX) — immediate UX impact
4. Sprint 6 (Teacher Quality) — operational value
5. Sprint 5 (Retention) — depends on Sprint 2
6. Sprint 7 (Control Tower) — benefits from 5+6
7. Sprint 1 (Stripe) — when API keys ready
8. Sprint 8 (AI) — when Anthropic key ready

---

## Success Metrics (Post-Hardening)

| Metric | Before | Target |
|--------|--------|--------|
| Revenue/Payment Readiness | C+ | A- |
| Operational Readiness | B | A- |
| Automation Maturity | B- | B+ |
| Parent Communication | Manual | Automated |
| Teacher Compliance | No tracking | Monitored |
| Admin Visibility | Per-page | Control tower |
| Churn Detection | None | Daily scoring |
| Message Delivery | Untracked | Logged per channel |

---

## Documentation Deliverables

| Document | Sprint | Purpose |
|----------|--------|---------|
| `EVENT_CATALOG.md` | Sprint 3 | Every event: trigger, payload, subscribers |
| `LIFECYCLES.md` | Sprint 3 | State machines for booking, session, follow-up, package |
| `AUDIT.md` | Done | Full platform audit |
| `ROADMAP.md` | This file | Implementation plan |
| `PROJECT.md` | Done | Technical reference |
| `automation/BLUEPRINT.md` | Done | 52 n8n workflows |
| `automation/VPS_HANDOFF.md` | Done | n8n Claude Code context (Mac mini as of 2026-04-23) |

---

## Post-Roadmap Phases (2026-04-23 session — 15 commits)

Phases shipped beyond the original 8-sprint plan, in a single session that took retention from skeleton to self-healing.

| # | Theme | What landed | Commit |
|---|---|---|---|
| 9 | Retention surface | `/admin/retention` ranked page + Control Tower widget + nav | `9c9dbb2` |
| 10 | Intervention loop | 5 intervention types + cooldown multipliers + `automation_logs` observability | `a97baa8` |
| 11 | Seed + surface | Run Scorer Now button + risk badges on `/admin/users` list & detail | `5fbe2ad` |
| 12 | Filters | URL-param filters (risk tier, package, contacted freshness) | `2121ec1` |
| 13 | Teacher reach | Teacher-scoped at-risk widget on teacher dashboard | `3068479` |
| 14 | Audit trail | `automation_logs` per-intervention history + collapsible UI | `c0930f5` |
| 15 | Stripe prep | Fulfillment + refund helpers + webhook shell (no SDK) | `02bacf8` |
| 16 | Report template | `buildSessionNarrative` + GET endpoint (dual-auth) | `d56ac44` |
| 17 | Report send | `sendSessionNarrative` + POST with optional AI override | `e73dc68` |
| 18 | Session-page hint | Risk badge on admin + teacher session detail (≥40 only) | `a4ed636` |
| 19 | Idempotency | `automation_logs` dedup guard before parent report send | `777782c` |
| 20 | Moderator reach | Platform-wide at-risk widget on moderator dashboard | `bd1d9a0` |

**Patterns established this session:**
- Shared helpers in `src/lib/retention/ui.ts` (Rule of Three, extracted at 3rd caller)
- AI-swappable slot pattern (`narrative_paragraph` field — template today, Claude tomorrow, zero surrounding shape change)
- Dual-auth endpoints (X-N8N-Secret OR cookie role check) to serve n8n + admin UI from one handler
- `automation_logs` as domain-visible observability + idempotency backing store (no migrations needed)
- Fast-read cache + slow-write log (CQRS at the table level) for `retention_signals.last_intervention_at` vs `automation_logs`

**Still blocked (both truly external):**
- Stripe SDK install + keys → Sprint 1 collapses to ~15 min of integration
- Anthropic key → Sprint 8's AI paragraph generation slots into the existing send pipeline

---

## Admin Audit Follow-ups (2026-04-25 session — `ec17f78`)

Deferred items from `ADMIN_AUDIT.md`. The audit applied 13 P1 + 18 P2 in waves 1–6; the following P3-and-risky items were intentionally not bundled.

### Needs DB apply
- `src/lib/supabase/migrations/v14_007_admin_perf.sql` — 6 admin-perf indexes (bookings status+date, sessions status+start, partial CV pending, retention churn-risk, notifications unread, audit_log time). Apply via Supabase SQL editor (separate account; not auto-applied by the repo migrations folder).

### Performance — needs careful per-page testing
- `/admin/sessions` — three-stage cascade (sessions → bookings → profiles). Collapse via single `Promise.all` with `.in()` on bookingIds and profileIds.
- `/admin/users` retention join — currently a legitimate two-stage query (need student IDs first). Could collapse with a Postgres view that pre-joins `profiles` and `retention_signals`.
- `/admin/dashboard` — 14 round-trips per load. Collapse into 2–3 Postgres views (`v_admin_dashboard_today`, `v_admin_dashboard_trends`) or RPCs.
- `/admin/control-tower` — at-risk packages query is sequential; low-balance filter applied client-side. Move into the existing `Promise.all` and use `.lt("remaining_sessions", 3)` server-side.
- Add `<Suspense>` boundaries around independent dashboard widgets so the page streams instead of waiting for the slowest query.

### A11y polish
- RTL logical-property sweep: ~9 admin form files use `text-left` / `ml-*` / `mr-*` / `right-*` / `pl-*` etc. Replace with `text-start` / `ms-*` / `me-*` / `end-*` / `ps-*`. Most current uses are on `dir="ltr"` fields where the behavior is identical, so this is hygiene, not a defect.
- Status badges on `/admin/teachers` and `/admin/teachers/[id]` rely on red/green color alone — add icons + text labels for color-blind users.
- Empty states on `/admin/announcements` and `/admin/retention` currently `return null` when no data; render an empty-state card.
- Hardcoded English service names in `/admin/settings` ("Supabase", "Daily.co", "Stripe") — wrap in `t()` or a constants file.
- Icon-only buttons across admin still missing `aria-label` in scattered places.
- Focus management on form modals — no focus trap; route transitions don't move focus to `<h1>`.

### Code quality / dead code
- ~26 admin files inline `supabase.from("profiles").select("role")` role checks — replace with shared `requireAdmin()` from `src/lib/auth/require-admin.ts` (already canonical).
- Inline `nameMap` of profile-id → name repeated across `users/page.tsx`, `teachers/page.tsx`, `bookings/page.tsx`, `sessions/page.tsx` — extract to `src/lib/admin/name-map.ts`.
- Heavy `as never` casts (9× in `sessions/actions.ts`, 8× in `teachers/[id]/actions.ts`, others) — regenerate Supabase Database types and remove.
- Stale TODO/FIXME and dead imports flagged by lens-1 agent — sweep with `next lint --fix` and a manual pass.

### Audit log gaps
- `forceEndSession` writes to `audit_log`, but `deleteUser`, force-cancel booking, package price change, settings toggle, automation replay don't. Add `audit_log` insert wrapper or a Postgres trigger.

**Still blocked (external):**
- Stripe checkout flow — Stripe API keys.
- AI parent reports — Anthropic API key in n8n.
- WhatsApp Business — Cloud API token.
- Google Calendar sync — OAuth setup.

---

## 15-Feature Reference-Match Build (2026-04-29 session)

User's nuvelabs e-learning reference identified 15 features/concepts; all shipped across 12 phases in a single session. New tables: 11. New routes: ~20. Feature flags: 6. Build commits: ~12.

| # | Feature | Status | Phase |
|---|---|---|---|
| 6 | Year filter wiring (topbar dropdown) | ✅ shipped | 1 |
| 11 | "Quran Student" role label | ✅ shipped | 1 |
| 13 | Sidebar collapsible sections | ✅ shipped | 1 |
| 15 | Theme toggle icon (kept sun/moon) | ✅ no-op | 1 |
| 4 | Continue Watching per-row menu (Resume/Mark complete/Hide) | ✅ shipped | 2 |
| 14 | Stacked-avatar Assignee column | ✅ shipped | 2 |
| 2 | Calendar view at /student/calendar | ✅ shipped | 3 |
| 1 | Time Tracker (study_log table + stopwatch UI + analytics integration) | ✅ shipped | 4 |
| 5 | Help Center with admin CMS | ✅ shipped | 5 |
| 9 | Resources library (PDFs/audio/links/etc.) | ✅ shipped | 6 |
| 12 | Account-switching dropdown stub | ✅ shipped | 7 |
| 3 | Real-time lesson-progress % (sessions.lesson_plan + ⚡ N% chip) | ✅ shipped | 8 |
| 8 | Module library (linear/thematic with unlock gating) | ✅ shipped | 9 |
| 7 | Quiz system (text-only MCQ + fill-in + true_false, auto-graded) + KPI 4 wiring | ✅ shipped | 10 |
| 10 | Community forum (threads/replies/likes/reports + moderation) | ✅ shipped | 11 |

**Feature flags created (default values):**
- `time_tracker_enabled` — true
- `help_center_enabled` — true
- `resources_enabled` — true
- `lesson_plan_enabled` — true
- `modules_enabled` — true
- `quizzes_enabled` — true
- `community_enabled` — **false** (admin must flip on after seeding categories)

**New routes added:**
- `/student/calendar`, `/student/time-tracker`, `/student/resources`, `/student/quizzes`, `/student/quizzes/[quizId]/take`
- `/admin/help`, `/admin/help/new`, `/admin/help/[id]/edit`, `/admin/resources`, `/admin/resources/new`, `/admin/resources/[id]/edit`, `/admin/community`
- `/help`, `/help/[slug]`, `/community`, `/community/new`, `/community/[id]`
- `/teacher/courses/[id]/modules`, `/teacher/courses/[id]/quizzes`, `/teacher/courses/[id]/quizzes/new`, `/teacher/courses/[id]/quizzes/[quizId]/edit`
