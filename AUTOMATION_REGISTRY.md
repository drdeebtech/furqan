# Automation Registry

> Per-workflow ownership, contracts, retry policy, and KPIs.
> Scope: n8n workflows on n8n.drdeeb.tech. Source of truth for operational responsibility.
>
> **Status convention**: rows without a `status` field are **live** (active in n8n and in `scripts/n8n-harden/run.mjs` TARGETS). Rows with `status: stubbed` are planned but not yet wired. Use `node scripts/n8n-audit.mjs` to diff this file against live n8n state.
>
> **WF-NN assignment**: IDs are stable and never reused. When adding a new workflow, scan for the highest existing WF-NN in its section range and use the next sequential number. Backlog rows use their planned section ranges (e.g., Session Lifecycle = 01–09, Student Retention = 20–29).

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

### WF-08 furqan-cron-auto-complete-sessions
- **owner**: ops
- **trigger**: cron `*/15 * * * *` → GET `/api/cron/auto-complete-sessions`
- **input**: `cron.fired` — polls sessions past end-time without a completed status
- **output**: session rows set to `auto_completed`; `session.auto_completed` event emitted
- **idempotency**: `cron-acs:{YYYYMMDD-HH-bucket}` — route-level per-session guard handles fine-grained dedup
- **retry**: 2 attempts, 2m backoff; terminal failure → `automation_logs` dead-letter row
- **alert_on**: `automation_logs` shows `status='failed'` for 3+ consecutive fires
- **kpi**: % sessions auto-completed within 30 min of scheduled end
- **flag**: none

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

### WF-28 furqan-cron-murajaah-due
- **owner**: product
- **trigger**: cron `0 9 * * *` → GET `/api/cron/murajaah-due`
- **input**: `cron.fired` — queries students with murajaah (revision) sessions due today
- **output**: `notify()` to student reminding them to book or start a revision session
- **idempotency**: `murajaah-due:{student_id}:{YYYYMMDD}`
- **retry**: 2 attempts, 5m backoff
- **alert_on**: zero notifications sent when >0 students have murajaah due (suggests query or notify failure)
- **kpi**: % murajaah-due students notified within 1h of 09:00 UTC
- **flag**: none

---

## Teacher Management (5)

### WF-30 furqan-teacher-quality-monitor
### WF-31 furqan-teacher-onboarding-nudges

### WF-32 furqan-cv-approval-notification
- **owner**: ops
- **trigger**: webhook `/webhook/furqan-cv-event`
- **input**: `teacher.cv_submitted` | `teacher.cv_approved` | `teacher.cv_rejected` | `teacher.cv_reset` — `{ teacher_id }`
- **output**: in-app `notify()` to admin (submitted) or teacher (approved / rejected / reset); `automation_logs` row
- **idempotency**: `cv-notify:{teacher_id}:{event}`
- **retry**: `continueOnFail` on Supabase notify node; failures surfaced via automation_logs
- **alert_on**: repeated failed notify inserts
- **kpi**: notification delivered within 30s of CV status change
- **flag**: none

### WF-35 furqan-teacher-status
- **n8n id**: `OTaYRQyIsTZYtsWz`
- **owner**: ops
- **trigger**: webhook `/webhook/furqan-teacher-status`
- **input**: `teacher.status_updated` — `{ teacher_id, is_accepting: boolean }`
- **output**: `automation_logs` row recording the status change; audit trail for teacher availability
- **idempotency**: `teacher-status:{teacher_id}:{timestamp_ms}` (each toggle is a distinct event)
- **retry**: none needed (log-only; idempotency_key includes timestamp)
- **alert_on**: none (informational log)
- **kpi**: every teacher availability toggle produces a log row within 5s
- **flag**: none

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

### WF-42 furqan-cron-handoff-cleanup
- **owner**: ops
- **trigger**: cron `0 3 * * *` → GET `/api/cron/handoff-cleanup`
- **input**: `cron.fired` — queries stale handoff records older than configured TTL
- **output**: stale handoff rows deleted; `handoff.cleanup_completed` event emitted
- **idempotency**: `handoff-cleanup:{YYYYMMDD}` — daily scoped
- **retry**: 2 attempts, 5m backoff
- **alert_on**: `automation_logs` shows `status='failed'` for 2+ consecutive fires
- **kpi**: handoff table row count stays bounded (< 500 open rows)
- **flag**: none

---

## Revenue (3+)

### WF-50 furqan-revenue-upsell
### WF-51 furqan-revenue-lapsed-return
### WF-52 furqan-revenue-trial-to-paid
### WF-53 furqan-revenue-teacher-payout

### WF-54 furqan-package-credit-granted
- **n8n id**: `9ax9JqAmRdeVVJpB`
- **owner**: ops
- **trigger**: webhook `/webhook/furqan-package-credit-granted`
- **input**: `package.credit_granted` — `{ student_id, sessions_granted, sessions_total, granted_by }`
- **output**: in-app `notify()` to student confirming sessions added; `automation_logs` row
- **idempotency**: `credit-granted:{student_id}:{timestamp_ms}` (each grant is distinct)
- **retry**: `continueOnFail` on Supabase notify node; failures visible via automation_logs
- **alert_on**: none (admin-triggered, rare operation)
- **kpi**: student notification delivered within 30s of admin grant
- **flag**: none

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

### WF-83 furqan-cron-cache-clear
- **owner**: ops
- **trigger**: cron `0 4 * * *` → GET `/api/cron/cache-clear`
- **input**: `cron.fired` — daily ISR/CDN cache bust
- **output**: Next.js revalidatePath() called for public routes; stale CDN entries invalidated
- **idempotency**: `cache-clear:{YYYYMMDD}` — daily scoped; revalidation is safe to repeat
- **retry**: 2 attempts, 5m backoff
- **alert_on**: `automation_logs` shows `status='failed'` for 2+ consecutive fires
- **kpi**: stale-content incidents zero after the 04:00 UTC window
- **flag**: none

### WF-84 furqan-cron-n8n-healthcheck
- **owner**: ops
- **trigger**: cron `*/15 * * * *` → GET `/api/cron/n8n-healthcheck`
- **input**: `cron.fired` — probes `n8n.drdeeb.tech/healthz` with 8s timeout
- **output**: state-change Telegram alert (up→down or down→up); `automation_logs` row per fire
- **idempotency**: `n8n-health:{YYYYMMDD-HH-MM-bucket}` — once-per-fire, stateful via automation_logs prev-status read
- **retry**: 1 attempt only (probe result is already the retry signal)
- **alert_on**: status flips from `up` to `down` (Telegram alert fires automatically from route logic)
- **kpi**: n8n downtime detected within 15 min; false-positive rate < 1/week
- **flag**: none

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

6. **Registry status**: rows in the `## Phase-N Backlog` section below are planned but not yet live. The `scripts/n8n-audit.mjs` script compares live workflows against ALL rows in this file — backlog rows will appear under `Registered + Missing` until activated. This is expected and not an error.

---

## Phase-N Backlog

> Planned workflows not yet wired to n8n. Grouped by rollout phase.
> Active (live) rows live in the numbered sections above.
> When a backlog workflow goes live: move its row to the appropriate section above and add it to `scripts/n8n-harden/run.mjs` TARGETS.

### Phase-2 Backlog — Retention Deepening

Stubs from `## Student Retention`, `## Teacher Management`, `## Revenue`, `## Booking Intelligence` sections above that have no full 11-field entry yet:

- `WF-21 furqan-retention-low-balance` — **status**: stubbed
- `WF-22 furqan-retention-expiry-countdown` — **status**: stubbed
- `WF-23 furqan-retention-renewal` — **status**: stubbed
- `WF-24 furqan-retention-abandoned-booking` — **status**: stubbed
- `WF-25 furqan-retention-inactivity` — **status**: stubbed
- `WF-26 furqan-retention-at-risk` — **status**: stubbed
- `WF-31 furqan-teacher-onboarding-nudges` — **status**: stubbed
- `WF-33 furqan-teacher-eval-compliance` — **status**: stubbed
- `WF-34 furqan-teacher-welcome` — **status**: stubbed
- `WF-50 furqan-revenue-upsell` — **status**: stubbed
- `WF-51 furqan-revenue-lapsed-return` — **status**: stubbed
- `WF-52 furqan-revenue-trial-to-paid` — **status**: stubbed
- `WF-53 furqan-revenue-teacher-payout` — **status**: stubbed
- `WF-60 furqan-booking-conflict-detector` — **status**: stubbed
- `WF-61 furqan-booking-recurring` — **status**: stubbed
- `WF-62 furqan-booking-waitlist-fill` — **status**: stubbed

### Phase-3 Backlog — AI & Messaging Workflows

- `WF-70 furqan-messaging-moderation` — **status**: stubbed
- `WF-71 furqan-messaging-announcement-broadcaster` — **status**: stubbed
- `WF-72 furqan-telegram-admin-bot` — **status**: stubbed

### Phase-4 Backlog — Platform Hardening

- `WF-04 furqan-session-auto-complete` — **status**: stubbed (replaced by WF-08 for cron path)
- `WF-05 furqan-session-auto-decline` — **status**: stubbed
- `WF-06 furqan-session-failure-sentinel` — **status**: stubbed
- `WF-07 furqan-session-health-check` — **status**: stubbed
- `WF-11 furqan-parent-missed-session-alert` — **status**: stubbed
- `WF-12 furqan-parent-homework-alert` — **status**: stubbed
- `WF-13 furqan-parent-weekly-digest` — **status**: stubbed
- `WF-27 furqan-retention-milestones` — **status**: stubbed
- `WF-30 furqan-teacher-quality-monitor` — **status**: stubbed
- `WF-80 furqan-health-old-data-cleanup` — **status**: stubbed
- `WF-81 furqan-health-broken-link-check` — **status**: stubbed
- `WF-82 furqan-health-credential-watcher` — **status**: stubbed
