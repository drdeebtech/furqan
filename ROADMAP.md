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

> **Status:** Blocked until Stripe test-mode API keys are provided
> **Impact:** Closes the #1 audit gap — revenue/payment readiness (C+ → A-)
> **Estimated effort:** 1 session

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

## Sprint 2: Communication Infrastructure [P1]

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

## Sprint 3: Event Contracts + Lifecycle Docs [P1]

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

**Homework lifecycle:**
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

## Sprint 4: Dashboard UX Hardening [P2]

> **Impact:** Shifts dashboards from data-heavy to action-oriented
> **Estimated effort:** 1 session

### Student dashboard changes
- Reorder widgets: **next session → homework due → package remaining → progress**
- Add "primary action" CTA based on state:
  - Has homework due? → "Go to homework"
  - No upcoming session? → "Book a session"
  - Package low? → "Renew package"

### Teacher dashboard changes
**Create:** `src/app/teacher/dashboard/action-queue.tsx`
- Single component showing prioritized action items:
  - Students awaiting grading (homework status=student_ready)
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

## Sprint 5: Retention Engine [P2]

> **Impact:** Reduces churn, increases renewal rates
> **Estimated effort:** 1 session (DB + types) + VPS session (n8n workflows)

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
| Falling homework completion | Medium | homework_assignments completed_needs_work/not_done |
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

## Sprint 6: Teacher Compliance & Quality [P2]

> **Impact:** Improves teacher consistency, surfaces issues early
> **Estimated effort:** 1 session

### Teacher action queue (code)
**Create:** `src/app/teacher/dashboard/action-queue.tsx`
- Pending homework to grade (count + links)
- Overdue evaluations (students with >4 sessions since last eval)
- Unread student messages
- Upcoming sessions today

### Teacher health metrics (admin view)
**Enhance:** `src/app/admin/teachers/[id]/page.tsx`
- Add metrics section: punctuality, grading lag, evaluation completion rate, no-show rate
- Query from bookings + homework_assignments + session_evaluations

### n8n workflows (VPS session)
- **Grading follow-up** — homework in student_ready > 48h → remind teacher
- **Evaluation compliance** — >4 sessions without evaluation → prompt teacher + admin
- **Weekly teacher snapshot** — summary to each teacher + admin overview

### Verification
- Teacher sees action queue with real data
- Admin sees teacher health metrics
- n8n sends grading/evaluation reminders

---

## Sprint 7: Admin Control Tower [P3]

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

> **Impact:** Differentiation, premium experience
> **Estimated effort:** Multiple sessions, requires Anthropic API key

### AI Parent Narratives (n8n workflow)
- Trigger: session.notes_saved
- Fetch rich context (session, homework, evaluation, progress)
- Claude API generates warm Arabic summary
- Fallback to structured template if AI fails
- Send via dispatcher (email/WhatsApp/in-app)
- Save to parent_reports

### AI Curriculum Advisor (n8n workflow)
- Weekly scan of recitation_errors + homework outcomes
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
| `LIFECYCLES.md` | Sprint 3 | State machines for booking, session, homework, package |
| `AUDIT.md` | Done | Full platform audit |
| `ROADMAP.md` | This file | Implementation plan |
| `PROJECT.md` | Done | Technical reference |
| `automation/BLUEPRINT.md` | Done | 52 n8n workflows |
| `automation/VPS_HANDOFF.md` | Done | n8n Claude Code context |
