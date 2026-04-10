# FURQAN State Machine Lifecycles

> Canonical state transitions for all major business entities.

---

## 1. Booking Lifecycle

```
                  ┌──────────┐
                  │ pending  │ ← Student creates booking
                  └────┬─────┘
                       │
              Teacher confirms │ Teacher declines
                       │              │
                  ┌────▼─────┐   ┌────▼──────┐
                  │confirmed │   │ cancelled │
                  └────┬─────┘   └───────────┘
                       │
            Session completes │ Student/teacher absent
                       │              │
                  ┌────▼─────┐   ┌────▼──────┐
                  │completed │   │  no_show  │
                  └──────────┘   └───────────┘
```

**Source of truth:** `bookings.status`
**Owner:** Booking domain (`src/app/student/bookings/new/actions.ts`, `src/app/teacher/dashboard/actions.ts`)

**Rules:**
- Only teacher can confirm (status: pending → confirmed)
- Confirmation creates Daily.co room + session record
- Overlapping confirmed bookings auto-cancel pending ones
- Cancellation stores `cancelled_by`, `cancel_reason`, `cancelled_at`
- No-show is set by teacher OR by no-show-detector automation
- Completed is set by endSession action

---

## 2. Session Lifecycle

```
                  ┌──────────┐
                  │ created  │ ← Room created on booking confirm
                  └────┬─────┘
                       │
            Participant joins
                       │
                  ┌────▼─────┐
                  │ started  │ ← started_at set on first join
                  └────┬─────┘
                       │
            Teacher ends session
                       │
                  ┌────▼─────┐
                  │  ended   │ ← ended_at set, actual_duration computed
                  └──────────┘
                       │
              Post-session flow
                       │
            ┌──────────▼──────────┐
            │ notes + homework    │
            │ saved by teacher    │
            └─────────────────────┘
```

**Source of truth:** `sessions.started_at`, `sessions.ended_at`
**Owner:** Session domain (`src/app/teacher/dashboard/actions.ts`)

**Rules:**
- Room expires at scheduled_at + 2 hours (extendable)
- Max 2 participants (3 with observer)
- Observer joins with camera/mic off
- actual_duration computed in minutes from started_at → ended_at
- Post-session: teacher adds notes, homework, optional evaluation

---

## 3. Homework Lifecycle

```
                  ┌──────────┐
                  │ assigned │ ← Teacher creates after session
                  └────┬─────┘
                       │
            Student clicks "I'm Ready"
                       │
                  ┌────▼─────────┐
                  │student_ready │
                  └────┬─────────┘
                       │
            Teacher grades
                       │
          ┌────────────┼────────────┐
          │            │            │
     ┌────▼──────┐ ┌──▼───┐ ┌─────▼──────────┐
     │ excellent │ │ good │ │ needs_work /   │
     └───────────┘ └──────┘ │ not_done       │
                            └──────┬─────────┘
                                   │
                          Auto-regenerate
                          (new homework with
                           parent_assignment_id)
                                   │
                            ┌──────▼─────┐
                            │  assigned  │ (new cycle)
                            └────────────┘
```

**Source of truth:** `homework_assignments.status`
**Owner:** Homework domain (`src/lib/actions/homework.ts`)

**Types:** hifz, muraja, recitation, tajweed, writing, listening
**Edit window:** Teacher can edit until next session starts
**Notifications:** assigned→student, ready→teacher, graded→student, not_done→parent

---

## 4. Package Lifecycle

```
                  ┌───────────┐
                  │ purchased │ ← Stripe payment succeeds (future)
                  └─────┬─────┘       OR admin manually assigns
                        │
                  ┌─────▼─────┐
                  │  active   │ ← sessions_used < sessions_total
                  └─────┬─────┘
                        │
          Sessions booked (atomic deduction)
                        │
           ┌────────────┼────────────┐
           │            │            │
     sessions_used   sessions_used   expires_at
     < total         = total         reached
           │            │            │
     ┌─────▼─────┐ ┌───▼───────┐ ┌─▼────────┐
     │  active   │ │ exhausted │ │ expired  │
     │ (ongoing) │ │ (renew!)  │ │ (renew!) │
     └───────────┘ └───────────┘ └──────────┘
                        │
                  Admin cancels
                        │
                  ┌─────▼──────┐
                  │ cancelled  │
                  └────────────┘
```

**Source of truth:** `student_packages.status`, `sessions_used`, `sessions_total`, `expires_at`
**Owner:** Package domain (`deduct_package_session()` SQL function)

**Deduction:** Atomic via `deduct_package_session(uuid)` — prevents race conditions
**Alerts:** n8n workflows for low balance (≤2) and expiry countdown (7/3/1 days)

---

## 5. Evaluation Lifecycle

```
                  ┌──────────┐
                  │ created  │ ← Teacher/admin creates evaluation
                  └────┬─────┘
                       │
            Notification sent to student
                       │
                  ┌────▼──────────┐
                  │ visible to    │ ← Student can view scores
                  │ student (RO)  │    and feedback
                  └────┬──────────┘
                       │
            Admin/mod can update
                       │
                  ┌────▼──────────┐
                  │   updated     │ ← Scores adjusted if needed
                  └───────────────┘
```

**Source of truth:** `session_evaluations`
**Owner:** Progress domain (`src/lib/actions/evaluations.ts`)

**Types:** weekly, biweekly, monthly, quarterly
**Scores:** hifz, tajweed, akhlaq, attendance, overall (all 1-10)
**Text:** strengths, weaknesses, recommendations, notes

---

## 6. Teacher CV Lifecycle

```
                  ┌──────────┐
                  │  draft   │ ← Teacher starts profile
                  └────┬─────┘
                       │
            Teacher submits CV
                       │
                  ┌────▼───────────┐
                  │pending_review  │ ← Moderator/admin reviews
                  └────┬───────────┘
                       │
          ┌────────────┼────────────┐
          │                         │
     ┌────▼─────┐            ┌─────▼────┐
     │ approved │            │ rejected │
     └──────────┘            └─────┬────┘
                                   │
                            Teacher revises
                                   │
                              ┌────▼─────┐
                              │  draft   │ (resubmit)
                              └──────────┘
```

**Source of truth:** `teacher_profiles.cv_status`
**Owner:** Teacher onboarding domain

---

## 7. Notification Delivery Lifecycle

```
                  ┌──────────┐
                  │ created  │ ← dispatchNotification() called
                  └────┬─────┘
                       │
            Check preferences + quiet hours
                       │
          ┌────────────┼────────────┐
          │            │            │
     ┌────▼────┐  ┌───▼────┐  ┌───▼──────┐
     │ in_app  │  │ email  │  │ whatsapp │
     └────┬────┘  └───┬────┘  └───┬──────┘
          │           │           │
     ┌────▼────┐  ┌───▼────┐  ┌───▼──────┐
     │  sent   │  │  sent  │  │   sent   │
     └────┬────┘  └───┬────┘  └───┬──────┘
          │           │           │
     Each logged in message_delivery_log
```

**Source of truth:** `message_delivery_log`
**Owner:** Communication domain (`src/lib/notifications/dispatcher.ts`)
