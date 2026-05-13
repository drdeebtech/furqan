# FURQAN × n8n — Master Automation Blueprint

> **Project:** FURQAN (فُرقان) online Quran academy  
> **Primary app:** `https://furqan.today`  
> **Automation engine:** `https://n8n.drdeeb.tech`  
> **Platform version:** FURQAN V11  
> **Document version:** Automation Blueprint V2  
> **Prepared on:** 2026-04-09

---

## 1. Executive Summary

FURQAN’s automation layer is not a collection of isolated workflows. It is the operational nervous system of the academy.

Its job is to turn a feature-rich Quran learning platform into a responsive, premium, and scalable service by automating:

- session operations
- parent communication
- teacher enablement
- retention and re-engagement
- admin visibility
- quality assurance
- revenue recovery and package renewal
- AI-assisted academic intelligence

The core app already has strong foundations: 4 roles, 29 tables, package management, structured follow-up, evaluations, messaging, notifications, video sessions, and feature flags. The automation layer should now capitalize on that maturity.

This document replaces the earlier n8n plan with a more comprehensive blueprint that includes:

- a full automation strategy
- integration architecture
- event taxonomy
- workflow design standards
- a revised workflow catalog
- quality, observability, and safety requirements
- phased implementation roadmap
- recommended data model additions for automation maturity

---

## 2. Strategic Goals

### 2.1 Primary outcomes

FURQAN automations should deliver five business outcomes:

1. **Reduce operational overhead**  
   Remove repetitive admin tasks such as reminders, alerts, room creation, routine reports, and follow-ups.

2. **Increase student retention**  
   Detect inactivity early, automate nudges, escalate academic risk, and keep parents engaged.

3. **Improve teacher consistency**  
   Monitor attendance, prompt evaluations, surface quality issues, and reward strong performance.

4. **Increase revenue efficiency**  
   Recover abandoned purchase intent, renew packages before expiry, and surface upsell opportunities.

5. **Create a premium parent experience**  
   Deliver timely, clear, emotionally intelligent, bilingual reports that make parents feel informed and reassured.

### 2.2 Automation philosophy

The automation system should follow these principles:

- **Operational automation first, advanced AI second**
- **Event-driven wherever possible, polling only where necessary**
- **Non-blocking to core user actions**
- **Arabic-first parent and user communication, bilingual where useful**
- **Feature-flagged rollout for risky or high-cost workflows**
- **Idempotent by design to prevent duplicates**
- **Observable, logged, and auditable**

---

## 3. Current State Assessment

### 3.1 What already exists in the platform

The core FURQAN application already supports the underlying primitives needed for strong automation:

- `profiles` with user role, language, timezone, parent contacts
- `teacher_profiles` with specialties, rates, review and approval state
- `bookings` and `sessions` for the session lifecycle
- `homework_assignments` with state machine and grading outcomes
- `student_progress` and `recitation_errors` for academic tracking
- `reviews`, `notifications`, `audit_log`, `parent_reports`
- `packages` and `student_packages` for pricing and renewal logic
- `platform_settings` for feature flags and operational switches

This is a strong base. The automation layer can already do meaningful work without waiting for major product changes.

### 3.2 Current n8n status

> **[Updated 2026-05-13 — spec 009]**: The live workflow count has grown well beyond this section's original snapshot. For the authoritative list of active workflows, owner assignments, and cron schedules, see `AUTOMATION_REGISTRY.md` and `scripts/n8n-harden/run.mjs` TARGETS (34+ entries as of spec 009). The "only 2 workflows" framing below was the state at blueprint-writing time.

Already active on the n8n instance (at blueprint-writing time; see registry for current state):

- Kuwait Daily News
- Claude Code via Telegram

Confirmed nodes available:

- Supabase
- Stripe and Stripe Trigger
- WhatsApp Business Cloud
- Telegram
- Twilio
- Schedule Trigger
- Webhook
- HTTP Request
- AI Agent (Claude/OpenAI)
- Email (SMTP)
- Code
- IF
- Set

Known blocker:

- MCP workflow creation and validation currently hit a `regenerateNodeIds` server-side issue
- Current workaround: generate workflow JSON and import it manually in the n8n UI

### 3.3 Audit conclusions on the previous automation plan

The previous plan was strong, but incomplete.

Its strengths:

- Good categorization
- Correct prioritization of reminders, health checks, Daily.co room creation, and parent reports
- Good instinct to use AI for parent communication rather than gimmicks
- Useful emphasis on admin alerts and scheduling intelligence

Its gaps:

- Underdeveloped revenue automation
- No true retention engine
- No teacher quality automation layer
- Weak observability and workflow standards
- No unified event naming system
- No central automation logging strategy
- No idempotency, retry, and dead-letter standards
- No workflow-level governance model

This blueprint closes those gaps.

---

## 4. Target Integration Architecture

```text
┌────────────────────────────┐
│     FURQAN Next.js App     │
│  public + dashboards + API │
└─────────────┬──────────────┘
              │
              │ writes / updates / business events
              ▼
┌────────────────────────────┐
│   Supabase PostgreSQL DB   │
│ profiles, bookings, etc.   │
└─────────────┬──────────────┘
              │
      webhooks / polling / cron
              ▼
┌────────────────────────────┐
│      n8n Automation Hub    │
│ event intake + processing  │
│ routing + AI + delivery    │
└────┬────────┬────────┬─────┘
     │        │        │
     ▼        ▼        ▼
 Email      WhatsApp  Telegram
     │        │        │
     └────┬───┴───┬────┘
          ▼       ▼
     Supabase   External APIs
     writeback  Daily / Stripe /
                Google Calendar /
                Claude / OpenAI
```

### 4.1 Recommended automation topology

Use three automation patterns:

1. **Event workflows**  
   Triggered by webhooks from app or DB changes.

2. **Scheduled workflows**  
   Triggered by time-based cron jobs for scans, reports, and cleanups.

3. **Service workflows**  
   Reusable workflows for common tasks such as sending notifications, formatting parent reports, or writing automation logs.

### 4.2 Recommended communication model

Not every workflow should send messages directly.

Prefer this pattern:

- workflow decides the business outcome
- workflow calls a shared notification sub-workflow or dispatcher
- dispatcher handles channel routing, language selection, templates, retry logic, and deduplication

This reduces duplication and keeps message style consistent.

---

## 5. Event Taxonomy Standard

One of the most important improvements is to standardize event names.

### 5.1 Naming convention

Use this format:

```text
{entity}.{action}
```

Examples:

- `profile.created`
- `teacher.cv_submitted`
- `teacher.cv_approved`
- `booking.created`
- `booking.confirmed`
- `booking.cancelled`
- `session.created`
- `session.started`
- `session.ended`
- `session.no_show_detected`
- `session.notes_saved`
- `homework.assigned`
- `homework.student_ready`
- `homework.graded`
- `evaluation.created`
- `package.purchased`
- `package.low_balance`
- `package.expiring_soon`
- `payment.succeeded`
- `payment.failed`
- `message.created`
- `review.created`
- `progress.milestone_reached`

### 5.2 Event payload shape

Every event emitted to n8n should follow a consistent body:

```json
{
  "event": "booking.confirmed",
  "occurred_at": "2026-04-09T12:00:00Z",
  "entity_id": "uuid",
  "actor_id": "uuid-or-null",
  "trace_id": "uuid",
  "source": "furqan-app",
  "data": {
    "booking_id": "uuid",
    "student_id": "uuid",
    "teacher_id": "uuid"
  }
}
```

### 5.3 Why this matters

This enables:

- cleaner workflow triggers
- easier observability
- replay and debugging
- future event archiving
- safer integration across multiple systems

---

## 6. Workflow Engineering Standards

Every production workflow should comply with the standards below.

### 6.1 Workflow metadata standard

Each workflow should document internally:

- workflow name
- owner
- business purpose
- trigger type
- input payload contract
- output actions
- failure behavior
- retry policy
- idempotency key
- related feature flag
- linked tables and APIs

### 6.2 Idempotency

Every workflow that may re-run must have duplicate protection.

Recommended idempotency key examples:

- `session-reminder:{booking_id}:{window}`
- `parent-report:{session_id}:{report_type}`
- `renewal-reminder:{student_package_id}:{days_remaining}`

Before sending or mutating, the workflow should check whether that key already exists in an automation log table.

### 6.3 Error handling standard

Each production workflow should include:

- primary try path
- retry path for transient errors
- terminal failure path
- error notification for critical workflows
- writeback to automation logs

### 6.4 Retry policy

Suggested defaults:

- API/network failures: retry 2–3 times with backoff
- AI failures: retry once, then fallback to non-AI template if applicable
- channel delivery failures: retry and switch channel if critical

### 6.5 Logging

Every workflow should write:

- start state
- finish state
- execution result
- duration
- channel delivery outcome
- error details if any

### 6.6 Fallback behavior

Examples:

- AI parent summary fails → send structured non-AI summary instead
- WhatsApp fails → email and in-app notification fallback
- Daily room creation fails → Telegram admin alert + booking flagged for manual intervention

### 6.7 Cost awareness

AI, WhatsApp, and PDF generation should be feature-flagged or threshold-limited where appropriate.

---

## 7. Recommended Supporting Data Additions

The current schema is strong, but automation maturity would improve with a few additions.

### 7.1 New table: `automation_logs`

Purpose:

- durable execution history
- deduplication
- debugging
- performance tracking

Suggested fields:

- `id`
- `workflow_name`
- `event_name`
- `entity_type`
- `entity_id`
- `idempotency_key`
- `status` (`started`, `succeeded`, `failed`, `skipped`)
- `channel`
- `payload_json`
- `result_json`
- `error_message`
- `attempt_count`
- `started_at`
- `finished_at`
- `trace_id`

### 7.2 New table: `automation_queue` (optional)

Use when you want app-side writes to enqueue future work explicitly.

### 7.3 New table: `announcements`

Needed if the announcement broadcaster will be first-class and admin-managed.

### 7.4 New table: `teacher_metrics_snapshots`

Optional, but valuable for weekly scoring and trend analysis.

### 7.5 New table: `student_risk_flags`

Optional, for retention and academic risk automation.

### 7.6 New settings in `platform_settings`

Recommended feature flags:

- `payments_enabled`
- `ai_parent_reports_enabled`
- `ai_teacher_matching_enabled`
- `whatsapp_enabled`
- `teacher_quality_monitor_enabled`
- `retention_automation_enabled`
- `renewal_campaigns_enabled`
- `calendar_sync_enabled`
- `message_moderation_enabled`
- `recording_notifications_enabled`

---

## 8. Master Workflow Catalog

This blueprint expands the automation system into 12 areas and 52 workflows.

Priority legend:

- 🔴 Critical
- 🟠 High
- 🔵 Medium
- 🟣 Phase 2 / advanced

---

## Area 01 — Session Lifecycle Operations (7 workflows)

### 1.1 Session Reminder Engine 🔴
Trigger: schedule every 5 minutes  
Flow: query upcoming confirmed bookings → determine 24h / 1h / 15m window → send reminders → log delivery  
Channels: email, WhatsApp, in-app, optional Telegram for teachers

### 1.2 Daily.co Room Auto-Creation 🔴
Trigger: `booking.confirmed`  
Flow: create Daily room → update `sessions.room_url` → notify student and teacher → log

### 1.3 Auto-Decline Stale Pending Bookings 🟠
Trigger: hourly schedule  
Flow: find pending bookings older than threshold with no teacher confirmation → cancel → notify student → log

### 1.4 Session Auto-Complete / Auto-Close 🟠
Trigger: every 15 minutes  
Flow: detect sessions that exceeded expected end threshold → set ended state → compute duration → log anomalies

### 1.5 No-Show Detector 🔴
Trigger: every 5–10 minutes around live sessions  
Flow: detect absent student or teacher after grace period → update status → notify stakeholders → log

### 1.6 Late Join Rescue Alert 🟠
Trigger: live session monitor  
Flow: session start passed, one participant missing → nudge missing user → alert admin if still unresolved

### 1.7 Recording / Replay Handler 🔵
Trigger: Daily webhook  
Flow: receive recording URL → store on session → notify parent or admin based on settings

---

## Area 02 — Parent Communication & Academic Reporting (7 workflows)

### 2.1 AI Parent Post-Session Report 🔴
Trigger: `session.notes_saved`  
Flow: fetch session + student + parent + follow-up + evaluation context → AI summary in Arabic or bilingual mode → send → save copy in `parent_reports`

### 2.2 Structured Fallback Parent Report 🔴
Trigger: same as 2.1 when AI unavailable  
Flow: generate templated summary without LLM → send → save copy

### 2.3 Weekly Progress Digest 🟠
Trigger: weekly schedule  
Flow: aggregate sessions, progress, follow-up outcomes, evaluations → send parent digest

### 2.4 Monthly Parent Master Report 🟣
Trigger: first of month  
Flow: AI-generated narrative report + charts/PDF if desired → email parent

### 2.5 Missed Session Parent Alert 🟠
Trigger: `session.no_show_detected`  
Flow: notify parent quickly with next step guidance

### 2.6 Follow-up Non-Completion Parent Alert 🟠
Trigger: `homework.graded` where outcome is `completed_not_done` or repeated `needs_work`  
Flow: notify parent with encouraging and actionable language

### 2.7 Milestone Celebration Messages 🔵
Trigger: `progress.milestone_reached`  
Flow: celebrate juz completion, session count milestones, consistency streaks

---

## Area 03 — Student Retention & Engagement (6 workflows)

### 3.1 Student At-Risk Detector 🔴
Trigger: daily schedule  
Flow: identify low attendance, repeated cancellations, no login, or stalled follow-up → score risk → create flag → notify retention queue/admin

### 3.2 Inactivity Re-Engagement Campaign 🟠
Trigger: daily or weekly schedule  
Flow: no sessions or login for defined period → send personalized win-back message

### 3.3 Low Package Balance Alert 🔴
Trigger: daily scan or after session deduction  
Flow: detect `sessions_remaining <= threshold` → send renewal nudge

### 3.4 Package Expiry Countdown 🔴
Trigger: daily schedule  
Flow: 7-day / 3-day / 1-day reminders before expiry → route through pricing and renewals template

### 3.5 Learning Streak Encouragement 🟠
Trigger: after completed sessions  
Flow: detect streak counts → congratulate student and optionally parent

### 3.6 Trial-to-Paid Conversion Journey 🟠
Trigger: new student registration or free trial booking  
Flow: timed educational and trust-building sequence to encourage first package purchase

---

## Area 04 — Revenue & Package Growth (6 workflows)

### 4.1 Abandoned Booking Recovery 🔴
Trigger: booking created but not confirmed or not completed within threshold  
Flow: reminder sequence → optional support CTA → log conversion outcome

### 4.2 Abandoned Checkout Recovery 🟠
Trigger: payment intent initiated but not completed  
Flow: email/WhatsApp recovery sequence once Stripe is active

### 4.3 Package Renewal Campaign 🔴
Trigger: package low balance or near expiry  
Flow: recommend suitable next package → send link → monitor purchase

### 4.4 Upsell to Higher Package 🟠
Trigger: strong attendance + high satisfaction + frequent renewals  
Flow: recommend more valuable package or full course

### 4.5 Lapsed Student Return Offer 🟠
Trigger: expired package and no new purchase within X days  
Flow: win-back sequence with optional discount or support follow-up

### 4.6 Payment Failure Recovery 🟠
Trigger: `payment.failed`  
Flow: explain issue, provide retry link, alert admin on repeated failures

---

## Area 05 — Teacher Onboarding & Enablement (4 workflows)

### 5.1 Role-Based Welcome Sequence 🟠
Trigger: `profile.created`  
Flow: branch by role → tailored onboarding sequence

### 5.2 Teacher Onboarding Nudges 🟠
Trigger: daily schedule  
Flow: detect incomplete onboarding steps such as CV, availability, profile → send reminder

### 5.3 CV Approval Notification Loop 🟠
Trigger: `teacher.cv_submitted`, `teacher.cv_approved`, `teacher.cv_rejected`  
Flow: notify admins for review, then notify teacher of outcome

### 5.4 First Student Celebration for Teachers 🔵
Trigger: teacher receives first completed booking  
Flow: motivational message and best-practice guidance

---

## Area 06 — Teacher Quality & Performance Intelligence (5 workflows)

### 6.1 Teacher Quality Monitor 🔴
Trigger: daily schedule  
Flow: aggregate no-shows, late starts, poor reviews, missing evaluations → compute risk → flag admin

### 6.2 Weekly Teacher Performance Snapshot 🟠
Trigger: weekly schedule  
Flow: send each teacher a concise performance summary and send admins comparative overview

### 6.3 Top Teacher Recognition Engine 🟠
Trigger: weekly or monthly ranking  
Flow: identify standout teachers and surface recognition or internal rewards

### 6.4 Teacher Evaluation Compliance Reminder 🟠
Trigger: after every 4 sessions or at required cadence  
Flow: remind teacher to submit evaluation → escalate if overdue

### 6.5 Teacher Coaching Insight Generator 🟣
Trigger: weekly schedule  
Flow: AI summarizes recurring student issues and suggests practical teaching improvements

---

## Area 07 — Booking & Scheduling Intelligence (5 workflows)

### 7.1 Booking Conflict Detector 🟠
Trigger: `booking.created`  
Flow: detect overlapping teacher availability or exception conflicts → suggest alternative slots

### 7.2 Recurring Booking Auto-Creator 🔵
Trigger: weekly schedule  
Flow: generate next batch of recurring sessions from patterns

### 7.3 Google Calendar Sync 🔵
Trigger: booking create/update/delete  
Flow: sync teacher calendar events when enabled

### 7.4 Teacher Matching Advisor 🟣
Trigger: new student intake  
Flow: AI scores suitable teachers using availability, language, gender preference, level, specialties, timezone

### 7.5 Waitlist / Slot Fill Assistant 🔵
Trigger: cancellation creates an empty premium slot  
Flow: notify suitable students or admins to fill the opening

---

## Area 08 — Messaging, Moderation & Communication (4 workflows)

### 8.1 Message Content Moderation 🟠
Trigger: `message.created`  
Flow: keyword filter → AI classification if needed → flag admin on suspicious content

### 8.2 Announcement Broadcaster 🟠
Trigger: `announcement.created` or admin webhook  
Flow: route campaign to in-app, email, WhatsApp, Telegram as appropriate

### 8.3 Telegram Admin Bot Extension 🔵
Trigger: Telegram webhook  
Flow: support `/stats`, `/pending`, `/sessions`, `/broadcast`, `/health`

### 8.4 WhatsApp Parent Self-Service Assistant 🟣
Trigger: WhatsApp inbound webhook  
Flow: limited read-only assistant using student progress and booking context

---

## Area 09 — Admin Operations & Visibility (4 workflows)

### 9.1 Daily Admin Digest 🔵
Trigger: every morning Kuwait time  
Flow: compile yesterday metrics, failures, signups, bookings, completions, revenue, no-shows

### 9.2 Real-Time KPI Alerting 🔴
Trigger: hourly schedule or event thresholds  
Flow: detect KPI breaches such as no-show spike, API failure, message backlog, parent report failures

### 9.3 Audit Log Enrichment 🔵
Trigger: `audit_log.insert`  
Flow: enrich with IP context, geo hint, severity score

### 9.4 Admin Review Queue Builder (formerly Moderator — dropped per ADR-0003) 🔵
Trigger: daily or event-based  
Flow: build queue for CV review, flagged messages, risky teachers, unresolved anomalies

---

## Area 10 — Payments, Finance & Billing (5 workflows)

> These workflows should remain feature-flagged until payments are live.

### 10.1 Stripe Webhook Handler 🔴
Trigger: Stripe events  
Flow: parse payment events → update `payments`, `payment_transactions`, `student_packages` → notify user

### 10.2 Invoice Generator 🔵
Trigger: payment success or monthly batch  
Flow: generate invoice PDF or hosted invoice link → store and send

### 10.3 Teacher Payout Calculator 🔵
Trigger: bi-weekly schedule  
Flow: compute teacher earnings from completed sessions → queue for admin approval

### 10.4 Refund Workflow Assistant 🔵
Trigger: admin refund request  
Flow: apply refund policy, compute amount, draft approval summary, update records after execution

### 10.5 Failed Renewal Escalation 🟠
Trigger: auto-renew or manual payment failure  
Flow: contact parent/student and surface admin follow-up

---

## Area 11 — Platform Health, Reliability & Data Hygiene (5 workflows)

### 11.1 Platform Health Check 🔴
Trigger: every 5 minutes  
Flow: ping app, Supabase, Daily, n8n dependencies → alert on outage or latency spike

### 11.2 Workflow Failure Sentinel 🔴
Trigger: n8n execution failure events or scheduled review  
Flow: aggregate failed workflow runs → Telegram admin alert with context

### 11.3 Old Data Cleanup 🔵
Trigger: weekly schedule  
Flow: archive aged audit logs, stale artifacts, and cold data candidates

### 11.4 Broken Link / Media Reference Check 🔵
Trigger: weekly schedule  
Flow: test stored URLs such as recordings, invoice links, media references

### 11.5 Credential Expiry / Configuration Watcher 🔵
Trigger: daily schedule  
Flow: check token validity windows and settings sanity for critical integrations

---

## Area 12 — AI Academic Intelligence (4 workflows)

### 12.1 Monthly AI Progress Report 🟣
Trigger: monthly  
Flow: synthesize all academic signals into a narrative progress report for parents

### 12.2 AI Curriculum Advisor 🟣
Trigger: weekly  
Flow: analyze recurring recitation errors and follow-up trends → suggest next focus areas for teacher

### 12.3 Student Weakness Pattern Detector 🟣
Trigger: daily or weekly  
Flow: identify recurring rule-level or memorization weaknesses → store insight for teacher dashboard

### 12.4 AI Academic Risk Classifier 🟣
Trigger: daily  
Flow: classify academic risk from attendance, errors, stagnation, follow-up, and evaluations

---

## 9. Priority Summary

| Priority | Meaning | Count |
|---|---|---:|
| 🔴 Critical | Directly affects reliability, retention, revenue, or trust | 16 |
| 🟠 High | Strong UX, teacher quality, operational efficiency | 18 |
| 🔵 Medium | Valuable optimization and admin leverage | 13 |
| 🟣 Phase 2 | AI-heavy or post-core maturity features | 9 |

Total workflows in this blueprint: **56** if all optional advanced variants are included, or **52** in the core catalog above depending on whether fallback and sentinel flows are counted separately in implementation.

---

## 10. Recommended Build Order

### Phase 1 — Core operational reliability

Build first:

1. Platform Health Check
2. Workflow Failure Sentinel
3. Session Reminder Engine
4. Daily.co Room Auto-Creation
5. No-Show Detector
6. AI Parent Post-Session Report
7. Structured Fallback Parent Report
8. Low Package Balance Alert
9. Package Expiry Countdown
10. Daily Admin Digest

### Phase 2 — Retention and quality systems

11. Student At-Risk Detector
12. Inactivity Re-Engagement Campaign
13. Teacher Quality Monitor
14. Teacher Evaluation Compliance Reminder
15. Booking Conflict Detector
16. Follow-up Non-Completion Parent Alert
17. Trial-to-Paid Conversion Journey
18. Package Renewal Campaign

### Phase 3 — Growth and intelligence

19. Upsell to Higher Package
20. Lapsed Student Return Offer
21. Weekly Teacher Performance Snapshot
22. Announcement Broadcaster
23. Google Calendar Sync
24. Message Moderation
25. Telegram Admin Bot Extension
26. Waitlist / Slot Fill Assistant

### Phase 4 — Advanced AI and finance

27. Stripe Webhook Handler
28. Invoice Generator
29. Teacher Payout Calculator
30. Monthly AI Progress Report
31. AI Curriculum Advisor
32. Student Weakness Pattern Detector
33. WhatsApp Parent Self-Service Assistant
34. Teacher Matching Advisor

---

## 11. Workflow Design Patterns

### 11.1 Standard event workflow pattern

```text
Webhook Trigger
→ Validate payload
→ Generate trace_id / idempotency key
→ Fetch context from Supabase
→ Apply business logic
→ Write mutation or decision
→ Call notification dispatcher
→ Write automation log
→ Exit
```

### 11.2 Standard scheduled workflow pattern

```text
Schedule Trigger
→ Query target rows from Supabase
→ Loop items safely in batches
→ Apply guard clauses
→ Perform action(s)
→ Write automation log per item
→ Summarize batch results
→ Notify admin if threshold breached
```

### 11.3 Standard AI workflow pattern

```text
Trigger
→ Fetch rich context
→ Pre-format deterministic facts
→ Call AI with constrained prompt
→ Validate result length/tone/language
→ Save output copy
→ Send through dispatcher
→ Fallback if AI unavailable
```

### 11.4 Shared notification dispatcher pattern

Inputs:

- event type
- audience type
- preferred language
- preferred channels
- payload variables

Responsibilities:

- choose channel order
- render template
- enforce dedupe
- retry transient failures
- record delivery result

---

## 12. Prompting Standards for AI Workflows

AI should be used carefully and predictably.

### 12.1 Allowed AI use cases

- parent report summarization
- teacher coaching suggestions
- teacher matching scoring
- academic weakness analysis
- message moderation classification

### 12.2 AI prompt requirements

Prompts must:

- clearly state the role and audience
- separate facts from interpretation
- ban hallucinated facts
- define output language
- define tone as warm, respectful, concise, and parent-safe
- instruct the model not to mention unavailable data

### 12.3 Parent report tone guide

Parent-facing output should be:

- encouraging, never alarming without reason
- respectful and faith-aligned in tone
- simple Arabic first, with optional concise English support
- specific about what was learned, what needs improvement, and what to do next

### 12.4 AI safety rule

No AI workflow should alter academic records or user status automatically without deterministic business logic approval.

AI may assist recommendations. It should not directly change canonical educational data on its own.

---

## 13. Observability & Admin Control

### 13.1 What admins should be able to see

At minimum, admins should eventually have visibility into:

- recent automation runs
- failed runs by workflow
- deliveries by channel
- parent report generation success rate
- no-show trend
- package renewal conversion trend
- teacher quality flags
- student risk flags

### 13.2 Telegram alert severity model

Recommended severity levels:

- `info` — successful daily digest, milestone counts
- `warning` — retries, delayed API, non-critical failures
- `critical` — platform down, room creation failed, bulk reminder failure, payment handler failure

### 13.3 Suggested admin metrics

- sessions scheduled today
- sessions completed today
- session no-show rate
- reminders sent
- parent reports sent
- AI fallback count
- package renewals due this week
- teachers flagged for review
- failed workflow executions in last 24h

---

## 14. Security, Privacy & Access Control

### 14.1 Core rules

- Use the Supabase service role only inside n8n where necessary
- Never expose service role credentials in client-side code
- Minimize sensitive payloads stored in logs
- Mask secrets and personally sensitive content in execution history when possible
- Restrict parent-facing data to only the relevant student context

### 14.2 Message handling

Moderation and AI classifiers should be assistive. Human review should remain in the loop for enforcement actions.

### 14.3 Auditability

Any automation that changes business state should leave a durable trace in either:

- `automation_logs`
- `audit_log`
- or both, depending on sensitivity

---

## 15. Environment & Credentials Checklist

Required credentials in n8n:

- Supabase service role key
- Daily.co API key
- Telegram bot token
- Telegram admin chat ID
- WhatsApp Business Cloud token
- SMTP or Gmail credential
- Anthropic API key
- Stripe secret key when payments are enabled
- Google Calendar OAuth when calendar sync is enabled

Recommended secret naming standard:

- `SUPABASE_SERVICE_ROLE_KEY`
- `DAILY_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`
- `WHATSAPP_CLOUD_TOKEN`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
- `ANTHROPIC_API_KEY`
- `STRIPE_SECRET_KEY`
- `GOOGLE_CALENDAR_OAUTH`

---

## 16. Import, Deployment & Versioning Process

Because programmatic creation is currently blocked, workflows should be treated like deployable artifacts.

### 16.1 Recommended workflow lifecycle

1. Design workflow in markdown spec
2. Create JSON locally
3. Save JSON in version-controlled folder
4. Import to n8n manually
5. Add credentials
6. Test in staging or with controlled sample data
7. Activate
8. Record version and owner

### 16.2 Recommended repo structure for workflow assets

```text
automation/
├── specs/
│   ├── 01-session-reminder-engine.md
│   ├── 02-parent-report.md
│   └── ...
├── json/
│   ├── n8n-furqan-session-reminder-engine.v1.json
│   ├── n8n-furqan-parent-report.v1.json
│   └── ...
└── prompts/
    ├── parent-report.ar.md
    ├── parent-report.bilingual.md
    └── teacher-coaching.md
```

### 16.3 Naming convention for workflow JSON files

```text
n8n-furqan-{workflow-slug}.v{n}.json
```

Example:

```text
n8n-furqan-session-reminder-engine.v1.json
```

---

## 17. Suggested Immediate Next Actions

### 17.1 Product/data actions

- Create `automation_logs`
- Decide whether to create `announcements`
- Add feature flags for major automation families
- Standardize event names in app-side webhooks

### 17.2 n8n implementation actions

- Import and activate Platform Health Check
- Import and activate Session Reminder Engine
- Build Daily.co Room Auto-Creation JSON
- Build Parent Report JSON with AI + fallback path
- Build Workflow Failure Sentinel
- Build Low Package Balance Alert

### 17.3 Governance actions

- Assign workflow owner for each critical automation
- Define naming and version rules
- Document every credential and its owner
- Decide Arabic-only vs bilingual parent messaging defaults

---

## 18. Final Recommendation

FURQAN is already beyond the stage where automation should be treated as an add-on.

It now has enough product depth that automation should be treated as a formal subsystem with:

- standards
- reusable components
- event contracts
- logging
- safety controls
- cost controls
- rollout discipline

The most important immediate wins are not the fanciest AI workflows.
They are the automations that improve trust and continuity:

- reminders
- room creation
- parent reports
- low-balance alerts
- no-show detection
- teacher quality monitoring
- health checks

Once those are stable, the advanced AI layer will compound value rather than create operational chaos.

This blueprint is designed to make FURQAN’s automation stack feel premium, reliable, and intentionally engineered rather than improvised.

---

## 19. Appendix — Core Workflow Shortlist for First Build Sprint

If only 8 workflows are built first, build these:

1. Platform Health Check
2. Workflow Failure Sentinel
3. Session Reminder Engine
4. Daily.co Room Auto-Creation
5. No-Show Detector
6. AI Parent Post-Session Report
7. Structured Fallback Parent Report
8. Low Package Balance Alert

If 12 are built, add:

9. Package Expiry Countdown
10. Daily Admin Digest
11. Teacher Quality Monitor
12. Student At-Risk Detector

---

## 20. Appendix — Example Feature Flag Matrix

| Setting Key | Default | Purpose |
|---|---|---|
| `payments_enabled` | false | Gate all payment workflows |
| `whatsapp_enabled` | true | Enable WhatsApp delivery |
| `ai_parent_reports_enabled` | true | Enable AI summaries for parents |
| `teacher_quality_monitor_enabled` | false | Start after metrics are validated |
| `retention_automation_enabled` | false | Enable risk and win-back workflows |
| `calendar_sync_enabled` | false | Enable Google Calendar sync |
| `message_moderation_enabled` | false | Enable moderation pipeline |
| `recording_notifications_enabled` | false | Control recording notifications |
| `ai_teacher_matching_enabled` | false | Phase 2 matching advisor |
| `renewal_campaigns_enabled` | true | Control package reminders and renewal flows |

---

## 21. Appendix — Example Workflow Spec Template

Use this format for each individual workflow spec file:

```md
# Workflow: Session Reminder Engine

## Purpose
Reduce no-shows by sending reminders at 24h, 1h, and 15m windows.

## Trigger
Schedule every 5 minutes.

## Input
Confirmed bookings in reminder windows.

## Business Rules
- Skip cancelled and completed bookings
- Skip if reminder already sent for same window
- Respect channel settings if configurable

## Steps
1. Query eligible bookings
2. Generate idempotency key
3. Render template in user language
4. Send notification(s)
5. Write automation log

## Failure Handling
- Retry transient delivery failures twice
- Alert admin if failure rate exceeds threshold

## Feature Flag
`reminders_enabled`

## Dependencies
Supabase, WhatsApp, Email, Telegram
```

---

## Spec-Kit Ops

### specs-index-nightly

**Trigger**: Cron `0 3 * * *` (03:00 UTC daily) on n8n.drdeeb.tech (Mac mini).

**Input**: SSH to the Mac mini, run `bash /path/to/furqan/automation/workflows/specs-index-cron.sh`.

**Business Rules**:
- Pull latest `main` (FF-only).
- Run `npx tsx scripts/generate-specs-index.ts` to regenerate `specs/INDEX.md`.
- If INDEX.md changed: commit with subject `[index-bot] regenerate specs/INDEX.md (cron drift correction)` (author: `drdeebtech@gmail.com` per Git Identity Rule), push to main.
- If INDEX.md unchanged: no-op (no empty commit).

**Steps**: see `automation/workflows/specs-index-cron.sh`.

**Failure Handling**:
- gh CLI auth/API failure → exit non-zero → n8n self-healing pattern fires Telegram alert + retries on next 03:00 UTC tick.
- No silent fall-back; INDEX.md correctness > coverage on a bad night (per spec FR-010).

**Feature Flag**: none — this is internal tooling, not user-facing.

**Dependencies**: Node 24.x (Mac mini), `gh` CLI authenticated, repo clone with push permission.

**Spec**: `specs/002-specs-index-generator/`.

