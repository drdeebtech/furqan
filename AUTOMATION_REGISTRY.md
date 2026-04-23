# Automation Registry

> Per-workflow ownership, contracts, retry policy, and KPIs.
> Scope: n8n workflows on n8n.drdeeb.tech. Source of truth for operational responsibility.

**Format for every workflow:**

```
| Field       | Description                                        |
|-------------|----------------------------------------------------|
| id          | WF-NN (stable, never reused)                       |
| name        | furqan-<area>-<verb>                               |
| owner       | Human responsible for correctness + on-call        |
| trigger     | webhook path / cron / manual                       |
| input       | Event name + payload shape                         |
| output      | Side-effects (notify, db write, 3rd-party call)    |
| idempotency | Key used to dedupe repeat invocations              |
| retry       | Attempts, backoff, dead-letter target              |
| alert_on    | Conditions that page admin (Telegram)              |
| kpi         | How we measure this workflow is working            |
| flag        | Feature flag gate (if any)                         |
```

---

## Session Lifecycle (7)

### WF-01 furqan-session-room-creation
- **owner**: ops
- **trigger**: webhook `/webhook/furqan-booking-confirmed`
- **input**: `booking.confirmed` { booking_id, scheduled_at, student_id, teacher_id }
- **output**: Daily.co room created; sessions row inserted; room_url stored
- **idempotency**: `booking.confirmed:{booking_id}`
- **retry**: 3 attempts, exponential 30s/2m/10m → `automation_dead_letter`
- **alert_on**: Daily.co API failure ≥3 consecutive
- **kpi**: % rooms created within 60s of confirmation
- **flag**: `automation_enabled`

### WF-02 furqan-session-reminder-engine
- **owner**: ops
- **trigger**: cron `*/10 * * * *`
- **input**: upcoming sessions in [15m, 1h, 24h] windows
- **output**: notify() to student + teacher per window
- **idempotency**: `reminder:{session_id}:{window}`
- **retry**: 2 attempts, 1m backoff
- **alert_on**: reminder-send failure rate >10% in 1h
- **kpi**: % sessions with at least one reminder delivered

### WF-03 furqan-session-no-show-detector
- **trigger**: cron every 5m during active session hours
- **output**: mark no_show; parent alert; admin flag
- **retry**: 2; dead-letter on final failure
- **kpi**: no-show detection within 10m of scheduled start + grace

### WF-04 furqan-session-auto-complete
### WF-05 furqan-session-auto-decline (teacher non-response)
### WF-06 furqan-session-failure-sentinel
### WF-07 furqan-session-health-check

---

## Parent Communication (4)

### WF-10 furqan-parent-post-session-report
- **trigger**: webhook `/webhook/furqan-session-notes-saved`
- **input**: `session.notes_saved` { session_id, teacher_id, student_id, notes }
- **output**: parent_reports row; notify parent; WhatsApp dispatch (when enabled)
- **idempotency**: `session_notes_saved:{session_id}`
- **retry**: 3; AI fallback to template on model error
- **alert_on**: AI call failure AND template fallback failure
- **kpi**: % sessions with report delivered within 30m
- **flag**: `ai_parent_reports_enabled` (else template-only)

### WF-11 furqan-parent-missed-session-alert
### WF-12 furqan-parent-homework-alert
### WF-13 furqan-parent-weekly-digest

---

## Student Retention (7)

### WF-20 furqan-retention-scorer *(daily)*
- **owner**: product
- **trigger**: cron `0 3 * * *` → POST `/api/cron/retention-score`
- **input**: none (internal scan)
- **output**: upsert into `retention_signals` for every active student
- **idempotency**: date-scoped (one row per student per day)
- **kpi**: scoring job completes < 60s; coverage = 100% active students
- **flag**: `retention_automation_enabled`

### WF-21 furqan-retention-low-balance
### WF-22 furqan-retention-expiry-countdown
### WF-23 furqan-retention-renewal
### WF-24 furqan-retention-abandoned-booking
### WF-25 furqan-retention-inactivity
### WF-26 furqan-retention-at-risk (feeds off WF-20 churn_risk_score ≥ 60)
### WF-27 furqan-retention-milestones

---

## Teacher Management (5)

### WF-30 furqan-teacher-quality-monitor
### WF-31 furqan-teacher-onboarding-nudges
### WF-32 furqan-teacher-cv-approval
### WF-33 furqan-teacher-eval-compliance
### WF-34 furqan-teacher-welcome

---

## Admin Operations (2)

### WF-40 furqan-admin-daily-digest
- **trigger**: cron `0 7 * * *`
- **output**: Telegram digest to admin: new signups, pending CVs, failed workflows, high-risk students, live session count
- **kpi**: digest delivered every day

### WF-41 furqan-admin-kpi-alerting
- Paging thresholds (examples):
  - workflow failure rate > 5% in 1h
  - no-show rate > 15% in a day
  - delivery_log failure rate > 10% in 1h

---

## Revenue (3+)

### WF-50 furqan-revenue-upsell
### WF-51 furqan-revenue-lapsed-return
### WF-52 furqan-revenue-trial-to-paid
### WF-53 furqan-revenue-teacher-payout

---

## Booking Intelligence (3+)

### WF-60 furqan-booking-conflict-detector
### WF-61 furqan-booking-recurring
### WF-62 furqan-booking-waitlist-fill

---

## Messaging (3+)

### WF-70 furqan-messaging-moderation
### WF-71 furqan-messaging-announcement-broadcaster
### WF-72 furqan-telegram-admin-bot

---

## Platform Health (3+)

### WF-80 furqan-health-old-data-cleanup
### WF-81 furqan-health-broken-link-check
### WF-82 furqan-health-credential-watcher

---

## Cross-cutting Rules

1. **Every webhook-triggered workflow MUST**:
   - Verify `X-N8N-Secret` on inbound if calling app webhooks
   - Write to `automation_logs` at start (`status=started`) and end (`succeeded`/`failed`/`skipped`)
   - Check `automation_logs` for its `idempotency_key` before doing work

2. **Every failure after final retry MUST**:
   - Write to `automation_dead_letter` with full payload + last error
   - Telegram page admin if workflow is tagged critical

3. **Feature flags gate "new" workflows** — flip in `/admin/settings` to roll out

4. **Naming**: `furqan-<area>-<verb>` kebab-case. Never rename; deprecate + superseded-by.

5. **Versioning**: append `-v2` to name when contract changes; keep v1 alive for 1 week
