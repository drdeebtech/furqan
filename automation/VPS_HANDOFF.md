# FURQAN n8n Handoff — Complete Context for Claude Code

> **2026-04-23 update:** n8n was migrated off the VPS and now runs on a **Mac mini**. `n8n.drdeeb.tech` points at the Mac mini instance. All 44+ workflows migrated. The rest of this doc still applies — substitute "VPS" with "Mac mini" wherever it appears.
>
> Give this file to Claude Code on the Mac mini to build and manage n8n workflows.
> Last updated: 2026-04-09 (host migration noted 2026-04-23)

---

## 1. YOUR MISSION

You are managing the n8n automation engine for FURQAN Academy (فُرقان), an online Quran teaching platform. Your job is to:

1. **Build n8n workflows** that automate session operations, parent communication, retention, teacher quality, and admin visibility
2. **Connect them** to the FURQAN app via Supabase (direct DB access) and webhooks
3. **Test and activate** each workflow
4. **Maintain** workflow health and fix failures

---

## 2. SYSTEM ARCHITECTURE

```
FURQAN App (furqan.today)          n8n (n8n.drdeeb.tech)
┌─────────────────────┐            ┌─────────────────────┐
│  Next.js 16 + React │            │  n8n Automation Hub  │
│  Vercel Hobby plan   │            │  Self-hosted on VPS  │
│                     │            │                     │
│  Server Actions ────────webhook──→  Webhook Triggers    │
│  (booking, session,  │            │  Schedule Triggers   │
│   follow-up events)   │            │  Supabase Node       │
│                     │            │  HTTP / AI / Email   │
│  /api/webhooks/n8n ←────callback──  Write logs/notifs   │
└─────────────────────┘            └─────────────────────┘
         │                                   │
         └──────── Supabase PostgreSQL ──────┘
                   (shared database)
```

---

## 3. ACCESS & CREDENTIALS

### Services you need access to:

| Service | URL | What you need |
|---------|-----|---------------|
| **n8n** | https://n8n.drdeeb.tech | Direct folder access on VPS |
| **Supabase** | xyqscjnqfeusgrhmwjts.supabase.co | Service role key (in n8n credentials) |
| **FURQAN App** | https://furqan.today | Webhook endpoints |
| **GitHub** | github.com/drdeebtech/furqan | Read-only context (code is on Vercel) |
| **Daily.co** | API key in n8n credentials | Video room management |
| **Telegram** | Bot token + admin chat ID | Admin alerts |

### n8n Credentials to configure:

| Credential Name | Type | Purpose |
|----------------|------|---------|
| `Supabase Service Role` | Supabase | Direct DB read/write (bypasses RLS) |
| `Daily.co API` | HTTP Header Auth | Video room creation |
| `Telegram Bot` | Telegram | Admin alerts |
| `WhatsApp Business` | HTTP Header Auth | Parent messaging |
| `SMTP / Gmail` | Email | Email delivery |
| `Anthropic API` | HTTP Header Auth | AI parent reports |
| `FURQAN App Webhook` | HTTP Header Auth | Callback to app |

### n8n → FURQAN App Callback

**Endpoint:** `https://furqan.today/api/webhooks/n8n`
**Auth:** Header `X-N8N-Secret: <value of N8N_WEBHOOK_SECRET env var>`

**Actions available:**

```json
// Log automation execution
{
  "action": "log",
  "workflow_name": "session-reminder-engine",
  "event_name": "booking.confirmed",
  "entity_type": "booking",
  "entity_id": "uuid",
  "idempotency_key": "session-reminder:uuid:24h",
  "status": "succeeded",
  "channel": "whatsapp",
  "payload": {},
  "result": {}
}

// Create in-app notification for a user
{
  "action": "notify",
  "user_id": "uuid",
  "type": "reminder",
  "title": "تذكير بجلستك",
  "body": "جلستك بعد ساعة — استعد!"
}

// Check if action already done (idempotency)
{
  "action": "check_idempotency",
  "idempotency_key": "session-reminder:uuid:24h"
}
// Returns: { "exists": true/false }
```

### FURQAN App → n8n Events

The app sends events to n8n via webhook POST. Event payload shape:

```json
{
  "event": "booking.confirmed",
  "occurred_at": "2026-04-09T12:00:00Z",
  "entity_type": "booking",
  "entity_id": "uuid",
  "actor_id": "uuid-or-null",
  "trace_id": "uuid",
  "source": "furqan-app",
  "data": {
    "student_id": "uuid",
    "teacher_id": "uuid"
  }
}
```

**Events currently emitted by the app:**

| Event | Trigger | Data |
|-------|---------|------|
| `booking.created` | Student creates booking | student_id, teacher_id, session_type, scheduled_at |
| `booking.confirmed` | Teacher confirms booking | student_id, teacher_id |
| `booking.cancelled` | Teacher cancels booking | student_id, teacher_id |
| `session.ended` | Teacher ends session | booking_id, teacher_id, actual_duration |
| `session.no_show` | Teacher marks no-show | student_id, teacher_id |
| `session.notes_saved` | Teacher saves post-session notes | has_notes, has_homework |
| `homework.assigned` | Teacher assigns follow-up | student_id, teacher_id, homework_type, title |
| `homework.student_ready` | Student marks ready | student_id, teacher_id |
| `homework.graded` | Teacher grades follow-up | student_id, teacher_id, grade |

---

## 4. DATABASE SCHEMA (Key Tables for Automation)

Access via Supabase node with service role key.

### profiles
```sql
id, role ('student'|'teacher'|'admin'), full_name, phone, country,
timezone, lang, is_active, parent_name, parent_phone, parent_email, date_of_birth
```

### teacher_profiles
```sql
teacher_id, bio, specialties[], hourly_rate, rating_avg, total_sessions,
is_accepting, cv_status ('draft'|'pending_review'|'approved'|'rejected')
```

### bookings
```sql
id, student_id, teacher_id, scheduled_at, duration_min, status ('pending'|'confirmed'|'completed'|'cancelled'|'no_show'),
session_type ('hifz'|'muraja'|'tajweed'|'tilawa'|'qiraat'|'tafsir'|'combined'|'other'),
teacher_confirmed, student_package_id
```

### sessions
```sql
id, booking_id, room_name, room_url, expires_at, started_at, ended_at,
actual_duration, post_session_notes, follow-up, teacher_joined, student_joined
```

### homework_assignments
```sql
id, booking_id, teacher_id, student_id, homework_type, status
('assigned'|'student_ready'|'completed_excellent'|'completed_good'|'completed_needs_work'|'completed_not_done'),
title, description, surah_number, ayah_start, ayah_end, teacher_notes, parent_assignment_id
```

### session_evaluations
```sql
id, student_id, teacher_id, evaluation_type ('weekly'|'biweekly'|'monthly'|'quarterly'),
hifz_score, tajweed_score, akhlaq_score, attendance_score, overall_score (all 1-10),
strengths, weaknesses, recommendations
```

### student_progress
```sql
id, student_id, teacher_id, booking_id, progress_type ('new'|'muraja'|'correction'),
surah_from, ayah_from, surah_to, ayah_to, quality_rating (1-5), level ('beginner'|'intermediate'|'advanced')
```

### packages
```sql
id, package_type, name, name_ar, session_count, duration_min, price_usd,
is_featured, is_active, display_order
```

### student_packages
```sql
id, student_id, package_id, sessions_total, sessions_used,
status ('active'|'expired'|'cancelled'), expires_at
```

### notifications
```sql
id, user_id, type ('booking'|'payment'|'message'|'reminder'|'system'|'follow-up'),
title, body, channel[], is_read, created_at
```

### parent_reports
```sql
id, student_id, teacher_id, report_type, title, body,
sent_to_email, sent_to_phone, sent_at, created_by
```

### automation_logs
```sql
id, workflow_name, event_name, entity_type, entity_id,
idempotency_key (UNIQUE), status ('started'|'succeeded'|'failed'|'skipped'),
channel, payload_json, result_json, error_message, attempt_count,
started_at, finished_at, trace_id
```

### platform_settings (Feature Flags)
```sql
key, value, description
-- Current automation flags:
-- automation_enabled = 'true'
-- whatsapp_enabled = 'true'
-- ai_parent_reports_enabled = 'false'
-- teacher_quality_monitor_enabled = 'false'
-- retention_automation_enabled = 'false'
-- renewal_campaigns_enabled = 'false'
```

---

## 5. WORKFLOW STANDARDS

### Every workflow MUST:

1. **Check feature flag** before executing (query `platform_settings` for the relevant flag)
2. **Check idempotency** before sending/mutating (query `automation_logs` for existing key)
3. **Write automation log** on completion (via app callback or direct Supabase insert)
4. **Handle errors** with retry (2-3x) and admin alert on permanent failure
5. **Use Arabic** for all user/parent facing messages

### Idempotency key format:
```
{workflow-slug}:{entity_id}:{window-or-variant}
```
Examples:
- `session-reminder:booking-uuid:24h`
- `session-reminder:booking-uuid:1h`
- `parent-report:session-uuid:post-session`
- `package-alert:student-package-uuid:low-balance`

### Workflow naming convention:
```
furqan-{area}-{workflow-slug}
```
Examples:
- `furqan-session-reminder-engine`
- `furqan-parent-post-session-report`
- `furqan-no-show-detector`

---

## 6. FIRST 8 WORKFLOWS TO BUILD (Priority Order)

### WF-1: Platform Health Check 🔴
- **Trigger:** Schedule every 5 minutes
- **Flow:** HTTP GET furqan.today → check 200 status. HTTP GET Supabase health endpoint. Check n8n self-health.
- **On failure:** Telegram alert to admin with error details
- **Log:** automation_logs with workflow_name = "platform-health-check"

### WF-2: Workflow Failure Sentinel 🔴
- **Trigger:** Schedule every 15 minutes
- **Flow:** Query n8n API for recent failed executions. If count > 0, send Telegram summary.
- **Log:** automation_logs

### WF-3: Session Reminder Engine 🔴
- **Trigger:** Schedule every 5 minutes
- **Flow:**
  1. Query `bookings` WHERE status='confirmed' AND scheduled_at between now+14min and now+25min (for 15min window), now+55min and now+65min (for 1h), now+23h and now+25h (for 24h)
  2. For each booking: generate idempotency_key = `session-reminder:{booking_id}:{window}`
  3. Check idempotency (query automation_logs or call app callback)
  4. If not sent: fetch student + teacher profiles
  5. Send reminder via in-app notification (app callback action=notify)
  6. Optionally: WhatsApp to parent (if whatsapp_enabled flag is true)
  7. Log to automation_logs

### WF-4: Daily.co Room Auto-Creation 🔴
- **Trigger:** Webhook (receives `booking.confirmed` event from app)
- **Flow:**
  1. Parse event payload
  2. Fetch booking details from Supabase
  3. Create Daily.co room: POST https://api.daily.co/v1/rooms with name=`furqan-{booking_id}`, expiry=scheduled_at+2h, max_participants=2
  4. Update `sessions` table: set room_url = room.url, room_name = room.name
  5. Log to automation_logs
- **Note:** The app already creates rooms in the confirm action, so this is a BACKUP/redundancy workflow. Check if room_url already exists before creating.

### WF-5: No-Show Detector 🔴
- **Trigger:** Schedule every 10 minutes
- **Flow:**
  1. Query `bookings` WHERE status='confirmed' AND scheduled_at < now()-15min
  2. Join with `sessions` to check teacher_joined and student_joined
  3. If neither joined: mark booking as no_show, notify admin
  4. If only one joined: notify the missing party + admin
  5. Log to automation_logs

### WF-6: AI Parent Post-Session Report 🔴
- **Trigger:** Webhook (receives `session.notes_saved` event from app)
- **Flow:**
  1. Check `ai_parent_reports_enabled` flag
  2. Fetch: session notes, follow-up, student name, teacher name, parent contacts, recent evaluations
  3. Build AI prompt with context (Arabic, warm, faith-aligned tone)
  4. Call Anthropic API (Claude) for summary generation
  5. Send to parent via WhatsApp/email
  6. Save in `parent_reports` table
  7. Log to automation_logs
- **Fallback:** If AI fails → use WF-7 (structured template)

### WF-7: Structured Fallback Parent Report 🔴
- **Trigger:** Same as WF-6, used when AI is unavailable
- **Flow:**
  1. Fetch same context as WF-6
  2. Generate template-based Arabic report: "أكمل/ت ابنكم جلسة بتاريخ X مع المعلم Y. الملاحظات: Z. المتابعة: W."
  3. Send + save + log

### WF-8: Low Package Balance Alert 🔴
- **Trigger:** Schedule daily at 8:00 AM Kuwait time
- **Flow:**
  1. Query `student_packages` WHERE status='active' AND (sessions_total - sessions_used) <= 2
  2. For each: check idempotency (package-alert:{id}:low-balance)
  3. If not sent: notify student (in-app + optional WhatsApp to parent)
  4. Log to automation_logs

---

## 7. NEXT 4 WORKFLOWS (After First 8)

### WF-9: Package Expiry Countdown
- Daily scan for packages expiring in 7/3/1 days → remind student + parent

### WF-10: Daily Admin Digest
- Morning summary: yesterday's sessions, completions, no-shows, signups, revenue, failures

### WF-11: Teacher Quality Monitor
- Weekly: aggregate no-shows, late starts, poor reviews, missing evaluations → flag admin

### WF-12: Student At-Risk Detector
- Daily: score risk from attendance + cancellations + follow-up + login → flag admin

---

## 8. AI PROMPT TEMPLATE FOR PARENT REPORTS

Use this prompt structure for WF-6:

```
You are writing a brief progress report for a parent about their child's Quran learning session.

CONTEXT:
- Student name: {student_name}
- Teacher name: {teacher_name}
- Session date: {date}
- Session type: {session_type}
- Duration: {duration} minutes
- Teacher notes: {post_session_notes}
- Follow-up assigned: {homework_title} — {homework_description}
- Recent evaluation (if any): Hifz {hifz}/10, Tajweed {tajweed}/10, Overall {overall}/10

RULES:
- Write in Arabic
- Warm, encouraging, faith-aligned tone
- 3-5 sentences maximum
- Mention what was learned, how the student performed, and what follow-up was assigned
- End with an encouraging note
- Do NOT mention scores unless they are 7+ (positive only)
- Do NOT invent facts not in the context
```

---

## 9. FULL WORKFLOW CATALOG (52 Workflows)

See `automation/BLUEPRINT.md` for the complete catalog organized by:
- Area 01: Session Lifecycle (7)
- Area 02: Parent Communication (7)
- Area 03: Student Retention (6)
- Area 04: Revenue & Packages (6)
- Area 05: Teacher Onboarding (4)
- Area 06: Teacher Quality (5)
- Area 07: Booking Intelligence (5)
- Area 08: Messaging & Communication (4)
- Area 09: Admin Operations (4)
- Area 10: Payments & Finance (5)
- Area 11: Platform Health (5)
- Area 12: AI Academic Intelligence (4)

---

## 10. n8n WORKFLOW JSON STRUCTURE

When creating workflows, save them as JSON files in:
```
/path/to/n8n/data/workflows/  (or wherever n8n stores workflow data)
```

Naming convention:
```
n8n-furqan-{workflow-slug}.v{n}.json
```

---

## 11. TESTING CHECKLIST

For each workflow:
1. Create in n8n UI or via API
2. Configure credentials
3. Test with sample data (manual trigger or test webhook)
4. Verify: automation_logs entry created
5. Verify: notification delivered (check app bell or Telegram)
6. Activate workflow
7. Monitor for 24h

---

## 12. IMPORTANT NOTES

- **Supabase account** is separate (alforqan.egy@gmail.com) — use service role key directly, not MCP
- **Vercel** deploys automatically on git push to main — don't modify the FURQAN codebase from VPS
- **n8n** has a known issue with `regenerateNodeIds` — create workflows via UI import if programmatic creation fails
- **WhatsApp Business Cloud** token needs to be configured in n8n credentials
- **Telegram bot** should send to admin chat ID for all alerts
- **All parent/student messages must be in Arabic**
- **Feature flags** in `platform_settings` table control which automation families are active — check before executing
