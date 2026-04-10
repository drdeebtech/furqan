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
| `homework.assigned` | Teacher assigns homework | `src/lib/actions/homework.ts` | student_id, teacher_id, homework_type, title | Student notification |
| `homework.student_ready` | Student marks ready | `src/lib/actions/homework.ts` | student_id, teacher_id | Teacher notification |
| `homework.graded` | Teacher grades homework | `src/lib/actions/homework.ts` | student_id, teacher_id, grade | Student notification, parent report (if not_done), auto-regeneration |

## Events Planned (Not Yet Emitted)

| Event | When to Add | Purpose |
|-------|-------------|---------|
| `profile.created` | User registration | Welcome sequence, onboarding nudges |
| `teacher.cv_submitted` | CV submission | Moderator review queue |
| `teacher.cv_approved` | CV approved | Teacher notification, public listing |
| `teacher.cv_rejected` | CV rejected | Teacher notification with reason |
| `evaluation.created` | Evaluation saved | Student/parent notification |
| `package.purchased` | Stripe payment succeeds | Fulfillment, confirmation |
| `package.low_balance` | Sessions ≤ 2 | Renewal nudge |
| `package.expiring_soon` | 7/3/1 days before expiry | Renewal urgency |
| `payment.succeeded` | Stripe webhook | Package fulfillment |
| `payment.failed` | Stripe webhook | Recovery flow |
| `message.created` | New message sent | Notification to recipient |
| `review.created` | Student leaves review | Teacher notification |
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
- Sends to `N8N_WEBHOOK_URL/furqan-events`
- 5-second timeout
