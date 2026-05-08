# FURQAN Event Catalog

> Every business event emitted by the app, its trigger, payload, and subscribers.

## Event Naming Convention
```
{entity}.{action}
```

## Events Currently Emitted

| Event | Trigger Point | Source File | Payload | n8n Subscribers |
|-------|--------------|-------------|---------|-----------------|
| `booking.created` | Student creates booking | `src/app/student/bookings/new/actions.ts` | student_id, teacher_id, session_type, scheduled_at | Reminder engine, admin digest |
| `booking.confirmed` | Teacher confirms booking | `src/app/teacher/dashboard/actions.ts` | student_id, teacher_id | Room creation, reminder scheduling |
| `booking.cancelled` | Teacher cancels booking | `src/app/teacher/dashboard/actions.ts` | student_id, teacher_id | Student notification, calendar sync |
| `session.ended` | Teacher ends session | `src/app/teacher/dashboard/actions.ts` | booking_id, teacher_id, actual_duration | Parent report, completion tracking |
| `session.no_show` | Teacher marks no-show | `src/app/teacher/dashboard/actions.ts` | student_id, teacher_id | Parent alert, risk scoring, admin flag |
| `session.notes_saved` | Teacher saves post-session notes | `src/app/teacher/sessions/[id]/actions.ts` | has_notes, has_homework | Parent report trigger |
| `homework.assigned` | Teacher assigns follow-up | `src/lib/actions/homework.ts` | student_id, teacher_id, homework_type, title | Student notification |
| `homework.student_ready` | Student marks ready | `src/lib/actions/homework.ts` | student_id, teacher_id | Teacher notification |
| `homework.graded` | Teacher grades follow-up | `src/lib/actions/homework.ts` | student_id, teacher_id, grade | Student notification, parent report (if not_done), auto-regeneration |
| `booking.no_show` | Booking transitions to no_show status | `src/app/teacher/dashboard/actions.ts` (via `markNoShow`) | student_id, teacher_id, booking_id | Risk scoring, parent alert |
| `retention.signal_triggered` | Churn-scoring computes a new signal | `src/app/admin/retention/actions.ts` | user_id, signal_type, score | Re-engagement workflows (gated on `retention_automation_enabled`) |
| `course.submitted` | Teacher submits course for review | `src/lib/actions/courses.ts` (`submitForReview`) | (none — entity_id = courseId) | Admin notification fanout, admin review queue |
| `course.approved` | Admin/mod approves course | `src/lib/actions/courses.ts` (`approveCourse`) | actor = admin_id | Teacher notification, course goes public |
| `course.rejected` | Admin/mod rejects course | `src/lib/actions/courses.ts` (`rejectCourse`) | reason | Teacher notification with reason |
| `course.enrolled` | Student enrolls (free) | `src/lib/actions/course-enrollments.ts` (`enrollFree`) | student_id, source | Teacher notification, welcome email (planned) |
| `lesson.completed` | Student crosses 90% watched threshold | `src/lib/actions/course-playback.ts` (`upsertLessonProgress`) | enrollment_id, student_id | Course completion check, milestone celebration |
| `review.created` | Student writes/updates a course review | `src/lib/actions/course-reviews.ts` (`writeReview`) | student_id, stars | Teacher notification (planned) |
| `package.purchased` | Student completes a PayPal package purchase | `src/app/(public)/packages/paypal-actions.ts` (`captureAndGrantPackage`) | student_id, package_id, payment_id, sessions_total, amount_usd | Admin Telegram alert, receipt email (planned), n8n welcome flow (planned) |

## Events Planned (Not Yet Emitted)

| Event | When to Add | Purpose |
|-------|-------------|---------|
| `profile.created` | User registration | Welcome sequence, onboarding nudges |
| `teacher.cv_submitted` | CV submission | Admin review queue |
| `teacher.cv_approved` | CV approved | Teacher notification, public listing |
| `teacher.cv_rejected` | CV rejected | Teacher notification with reason |
| `evaluation.created` | Evaluation saved | Student/parent notification |
| `package.purchased` | Stripe payment succeeds | Fulfillment, confirmation |
| `package.low_balance` | Sessions ≤ 2 | Renewal nudge |
| `package.expiring_soon` | 7/3/1 days before expiry | Renewal urgency |
| `payment.succeeded` | Stripe webhook | Package fulfillment |
| `payment.failed` | Stripe webhook | Recovery flow |
| `message.created` | New message sent | Notification to recipient |
| `progress.milestone_reached` | Juz/session milestone | Celebration message |

## Event Payload Shape

```json
{
  "event": "booking.confirmed",
  "occurred_at": "2026-04-10T12:00:00Z",
  "entity_type": "booking",
  "entity_id": "uuid",
  "actor_id": "uuid-or-null",
  "trace_id": "uuid",
  "source": "furqan-app",
  "data": { ... }
}
```

## Emission Function
`src/lib/automation/emit.ts` → `emitEvent(eventName, entityType, entityId, data, actorId?)`
- Non-blocking (fire-and-forget in try/catch)
- Sends to `N8N_WEBHOOK_URL/<route>` (per-event route map in `WEBHOOK_ROUTES`, fallback `/furqan-events`)
- 5-second timeout
- HMAC-SHA256 signed (`X-Furqan-Signature` + `X-Furqan-Timestamp`); see `src/lib/security/secrets.ts`
- Gated on `automation_enabled` master flag and per-event sub-flags (`EVENT_SUB_FLAGS` in emit.ts) — suppressed events write `status='skipped'` to `automation_logs` so admins can audit what was blocked

## Outbound HTTP contract

Every outbound POST carries:

| Header | Purpose |
|--------|---------|
| `Content-Type: application/json` | standard |
| `X-Furqan-Event` | event name, used by n8n routing |
| `X-Furqan-Timestamp` | unix-seconds the payload was signed |
| `X-Furqan-Signature` | hex HMAC-SHA256 of `${timestamp}.${rawBody}` keyed by `N8N_WEBHOOK_SECRET` |

Verifier requirements (n8n side):
1. Reject if `|now - timestamp| > 300` seconds (replay window).
2. Reproduce the canonical body via the rules in `src/lib/automation/payload.ts:serializePayload` — top-level fields in pinned order, `data` keys sorted alphabetically.
3. Recompute HMAC-SHA256 and compare with constant-time equality.

## Inbound callback (n8n → app)

Endpoint: `POST /api/webhooks/n8n` (see `src/app/api/webhooks/n8n/route.ts`)

| Header | Purpose |
|--------|---------|
| `X-N8N-Secret` | shared secret, constant-time compared with `N8N_WEBHOOK_SECRET` |

Actions: `log`, `notify`, `check_idempotency`. The `notify` action is rate-limited per-recipient to 30/minute; throttled attempts log to `message_delivery_log` with `status='throttled'`.
