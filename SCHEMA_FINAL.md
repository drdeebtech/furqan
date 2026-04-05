# FURQAN Academy — Schema FINAL (V7 + V8 + V9 Complete)

## Stack
Next.js 16 App Router · Supabase (PostgreSQL 17) · Stripe · Daily.co · Vercel

## Overview
- **Mode**: Academy Phase 1 — admin-appointed teachers, no marketplace
- **Roles**: 4 (student, teacher, admin, moderator)
- **Tables**: 25 (14 from V7 + 6 from V8 + 5 from V9)
- **Triggers**: 16
- **RLS Policies**: 32 (22 from V7/V8 + 10 from V9)
- **Edge Functions**: 4 (auto-reminder, auto-complete, no-show-detector, weekly-report)
- **This file**: Complete merged schema — V7 base + V8 + V9 additions

---

## ENUMS

```sql
user_role:       student | teacher | admin | moderator        -- V9: added moderator
gender_type:     male | female
booking_status:  pending | confirmed | completed | cancelled | no_show
session_type:    hifz | muraja | tajweed | tilawa | qiraat | tafsir | combined | other
payment_status:  pending | succeeded | failed | refunded
msg_type:        text | audio | file
notif_type:      booking | payment | message | reminder | system
student_level:   beginner | intermediate | advanced
cv_status:       draft | pending_review | approved | rejected       -- V9 NEW
evaluation_type: weekly | biweekly | monthly | quarterly            -- V9 NEW
report_type:     session_summary | evaluation | custom | missed_session | schedule_change  -- V9 NEW
```

---

## TABLE 1 — profiles

Auto-created on signup via trigger from auth.users.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK REFERENCES auth.users(id) ON DELETE CASCADE | |
| role | user_role | NOT NULL DEFAULT 'student' | student\|teacher\|admin |
| full_name | text | | |
| avatar_url | text | | Supabase Storage URL |
| phone | text | CHECK(phone ~ '^\+?[0-9]{7,15}$') | |
| country | text | | ISO 2-char code |
| timezone | text | NOT NULL DEFAULT 'UTC' | |
| lang | text | NOT NULL DEFAULT 'ar' | ar\|en\|fr\|tr |
| is_active | boolean | NOT NULL DEFAULT true | |
| deleted_at | timestamptz | | Soft delete — NULL = active |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz | NOT NULL DEFAULT NOW() | AUTO via trigger |
| parent_name | text | | V9: guardian name |
| parent_phone | text | | V9: guardian phone |
| parent_email | text | | V9: guardian email |
| date_of_birth | date | | V9: student DOB |

**Trigger**: `handle_new_user` — AFTER INSERT ON auth.users → inserts into profiles
**Trigger**: `t_profiles_upd` — BEFORE UPDATE → set_updated_at()
**RLS**:
- SELECT: `true` (public)
- UPDATE: `auth.uid() = id` (own only)

---

## TABLE 2 — teacher_profiles

Extended data for teachers — created manually by admin.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | Separate PK from teacher_id |
| teacher_id | uuid | UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE | |
| bio | text | | |
| specialties | text[] | NOT NULL DEFAULT '{}' | session types teacher offers |
| recitation_standards | text[] | NOT NULL DEFAULT '{hafs}' CHECK(⊆ {hafs,warsh,qalon,al_duri,shu_ba}) | V8 addition |
| languages | text[] | NOT NULL DEFAULT '{ar}' | |
| hourly_rate | numeric(10,2) | NOT NULL CHECK(BETWEEN 1 AND 500) | USD per hour |
| gender | gender_type | | male\|female |
| intro_video_url | text | | Introduction video |
| max_active_students | integer | | NULL = unlimited |
| rating_avg | numeric(3,2) | NOT NULL DEFAULT 0 CHECK(BETWEEN 0 AND 5) | AUTO via trigger |
| total_sessions | integer | NOT NULL DEFAULT 0 | AUTO via trigger |
| is_accepting | boolean | NOT NULL DEFAULT true | accepting new students? |
| is_archived | boolean | NOT NULL DEFAULT false | V8 addition — soft delete |
| archived_at | timestamptz | | V8 addition |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |
| updated_at | timestamptz | NOT NULL DEFAULT NOW() | AUTO via trigger |
| cv_status | cv_status | DEFAULT 'draft' | V9: CV workflow status |
| cv_submitted_at | timestamptz | | V9: when CV was submitted for review |
| cv_reviewed_by | uuid | REFERENCES profiles(id) | V9: admin/mod who reviewed |
| cv_reviewed_at | timestamptz | | V9: when CV was reviewed |
| cv_rejection_reason | text | | V9: reason if rejected |

**Trigger**: `t_tp_upd` — BEFORE UPDATE → set_updated_at()
**Trigger**: `update_teacher_rating` — AFTER INSERT/UPDATE/DELETE ON reviews → updates rating_avg
**Trigger**: `inc_teacher_sessions` — AFTER UPDATE ON bookings WHEN completed → total_sessions+1 + revenue_recognized
**RLS**:
- SELECT: `true` (public)
- UPDATE: `auth.uid() = teacher_id OR is_admin()`

---

## TABLE 3 — teacher_ijaza *(V8 NEW)*

Quran teaching certificates and chain of narration (sanad).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| teacher_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE CASCADE | |
| riwaya | text | NOT NULL CHECK(IN('hafs','warsh','qalon','al_duri','shu_ba')) | |
| chain_text | text | NOT NULL | Full sanad text |
| granted_by | text | | Sheikh name |
| granted_at | date | | |
| document_url | text | | Supabase Storage PDF |
| verified_by | uuid | REFERENCES profiles(id) ON DELETE SET NULL | admin who verified |
| verified_at | timestamptz | | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Index**: (teacher_id)
**RLS**:
- SELECT: `true` (public)
- ALL: `auth.uid() = teacher_id OR is_admin()`

---

## TABLE 4 — refund_policies

Configurable refund rules — stored in DB not hardcoded.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| hours_before_min | integer | NOT NULL | From X hours before |
| hours_before_max | integer | | NULL = no upper limit (infinity) |
| refund_percentage | numeric(5,2) | NOT NULL CHECK(BETWEEN 0 AND 100) | |
| description | text | | UI display text |
| is_active | boolean | NOT NULL DEFAULT true | |
| sort_order | integer | NOT NULL DEFAULT 0 | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Constraint**: CHECK(hours_before_max IS NULL OR hours_before_max > hours_before_min)

**Seed data**:
```
(48, NULL, 100, '48h+ → full refund',    sort_order=1)
(24, 48,    50, '24-48h → 50% refund',   sort_order=2)
(0,  24,     0, '<24h → no refund',      sort_order=3)
```

**RLS**:
- SELECT: `true` (public)
- ALL: `is_admin()`

---

## TABLE 5 — payments

Payment intents — note DEFERRABLE FK to resolve circular dependency with bookings.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| booking_id | uuid | UNIQUE — FK added via ALTER TABLE with DEFERRABLE INITIALLY DEFERRED | Circular dep solution |
| student_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| stripe_payment_intent | text | UNIQUE NOT NULL | |
| amount_usd | numeric(10,2) | NOT NULL CHECK(> 0) | Base accounting currency |
| amount_local | numeric(12,2) | | Display only |
| local_currency | text | CHECK(= UPPER(local_currency)) | KWD\|SAR\|EGP\|AED etc |
| exchange_rate_snapshot | numeric(10,6) | | Locked at payment time |
| amount_before_tax | numeric(10,2) | NOT NULL DEFAULT 0 | |
| tax_rate | numeric(5,2) | NOT NULL DEFAULT 0 | e.g. 15 for 15% |
| tax_amount | numeric(10,2) | NOT NULL DEFAULT 0 | |
| revenue_recognized | numeric(10,2) | NOT NULL DEFAULT 0 | Increases on booking completed |
| status | payment_status | NOT NULL DEFAULT 'pending' | |
| paid_at | timestamptz | | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Constraint**: CHECK(amount_usd = amount_before_tax + tax_amount)
**Index**: (status), (student_id)

**Important**: booking_id FK is added AFTER bookings table is created:
```sql
ALTER TABLE payments ADD CONSTRAINT fk_payments_booking
  FOREIGN KEY(booking_id) REFERENCES bookings(id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
```

**RLS**:
- SELECT: `auth.uid() = student_id OR is_admin()`

---

## TABLE 6 — payment_transactions *(V8 NEW)*

Individual financial movements — each charge/refund is a separate row.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| payment_id | uuid | NOT NULL REFERENCES payments(id) ON DELETE RESTRICT | |
| type | text | NOT NULL CHECK(IN('charge','refund','adjustment')) | |
| amount_usd | numeric(10,2) | NOT NULL CHECK(> 0) | |
| stripe_id | text | UNIQUE | charge_xxx or refund_xxx |
| description | text | | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Index**: (payment_id)
**RLS**:
- SELECT: `is_admin()`

---

## TABLE 7 — student_credits

Session credits purchased or gifted.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| student_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| teacher_id | uuid | REFERENCES profiles(id) ON DELETE RESTRICT | NULL = usable with any teacher |
| total | integer | NOT NULL CHECK(> 0) | |
| used | integer | NOT NULL DEFAULT 0 | |
| — remaining — | computed | total - used | Never stored — always compute in query |
| credit_value_usd | numeric(10,2) | | Value per credit for partial refund calc |
| expires_at | timestamptz | | NULL = never expires |
| source | text | NOT NULL DEFAULT 'purchase' CHECK(IN('purchase','refund','gift','admin')) | |
| payment_id | uuid | REFERENCES payments(id) ON DELETE RESTRICT | NULL for gift/admin |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Constraints**: CHECK(used <= total) · CHECK(total > 0)
**Partial Index**: (student_id, teacher_id, expires_at) WHERE used < total
**Trigger**: `validate_credits_total` — BEFORE UPDATE → prevents reducing total below used
**Trigger**: `deduct_student_credit` — AFTER UPDATE ON bookings WHEN pending→confirmed
**Trigger**: `restore_student_credit` — AFTER UPDATE ON bookings WHEN confirmed→cancelled
**RLS**:
- SELECT: `auth.uid() = student_id`

---

## TABLE 8 — teacher_availability

Weekly recurring schedule slots.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| teacher_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE CASCADE | |
| day_of_week | integer | NOT NULL CHECK(BETWEEN 0 AND 6) | 0=Sunday |
| start_time | time | NOT NULL | |
| end_time | time | NOT NULL | |
| slot_duration | integer | NOT NULL DEFAULT 60 CHECK(IN(30,45,60)) | minutes |
| is_active | boolean | NOT NULL DEFAULT true | |

**Note**: NO created_at or updated_at on this table.
**Constraints**: UNIQUE(teacher_id, day_of_week, start_time) · CHECK(end_time > start_time)
**RLS**:
- SELECT: `true` (public)
- ALL: `auth.uid() = teacher_id OR is_admin()`

---

## TABLE 9 — availability_exceptions

One-off overrides — holidays, sick days, special events.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| teacher_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE CASCADE | |
| date | date | NOT NULL | Future date enforced in app layer |
| start_time | time | | NULL = entire day blocked |
| end_time | time | | NULL = entire day blocked |
| is_blocked | boolean | NOT NULL DEFAULT true | |
| reason | text | | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Constraint**: CHECK(start_time IS NULL OR end_time IS NULL OR end_time > start_time)
**Index**: (teacher_id, date)

---

## TABLE 10 — bookings

Core booking table — most complex table in the system.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| student_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| teacher_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| created_by | uuid | REFERENCES profiles(id) ON DELETE SET NULL | NULL=student self, UUID=admin booked on behalf |
| rescheduled_from | uuid | REFERENCES bookings(id) ON DELETE SET NULL | Self-referencing |
| refund_policy_id | uuid | REFERENCES refund_policies(id) ON DELETE RESTRICT | IMMUTABLE after set |
| scheduled_at | timestamptz | NOT NULL | IMMUTABLE when confirmed |
| duration_min | integer | NOT NULL CHECK(IN(30,45,60)) | IMMUTABLE when confirmed |
| status | booking_status | NOT NULL DEFAULT 'pending' | TRANSITION GUARDED by trigger |
| session_type | session_type | NOT NULL DEFAULT 'hifz' | Validated against teacher specialties |
| rate_snapshot | numeric(10,2) | NOT NULL | IMMUTABLE — teacher's hourly_rate locked at booking |
| amount_usd | numeric(10,2) | NOT NULL CHECK(> 0) | = rate_snapshot × (duration_min/60) — calculated in app |
| amount_local | numeric(12,2) | | Display only |
| local_currency | text | CHECK(= UPPER(local_currency)) | |
| exchange_rate | numeric(10,6) | | Locked at booking time |
| tax_rate | numeric(5,2) | NOT NULL DEFAULT 0 | |
| tax_amount | numeric(10,2) | NOT NULL DEFAULT 0 | |
| notes | text | | Student notes |
| cancelled_by | uuid | REFERENCES profiles(id) ON DELETE SET NULL | |
| cancel_reason | text | | |
| cancelled_at | timestamptz | | AUTO SET by trigger |
| deleted_at | timestamptz | | Soft delete |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |
| teacher_confirmed | boolean | DEFAULT false | V9: teacher explicitly confirmed |
| teacher_confirmed_at | timestamptz | | V9: when teacher confirmed |
| decline_reason | text | | V9: reason if declined |

**Key Constraints**:
```sql
CONSTRAINT no_self_booking    CHECK(student_id != teacher_id)
CONSTRAINT no_self_reschedule CHECK(rescheduled_from != id)
CONSTRAINT no_booking_overlap EXCLUDE USING gist(
  teacher_id WITH =,
  tstzrange(scheduled_at, scheduled_at + (duration_min * INTERVAL '1 minute')) WITH &&
) WHERE (status NOT IN ('cancelled','no_show'))
```

**Valid Status Transitions**:
```
pending   → confirmed | cancelled
confirmed → completed | cancelled | no_show
completed → TERMINAL (no change allowed)
cancelled → TERMINAL (no change allowed)
no_show   → TERMINAL (no change allowed)
```

**Triggers**:
- `validate_booking_status` — BEFORE UPDATE: guards transitions + admin bypass via is_admin()
- `lock_rate_snapshot` — BEFORE UPDATE: immutable after set + admin bypass
- `lock_refund_policy` — BEFORE UPDATE: immutable after set + admin bypass
- `lock_confirmed_fields` — BEFORE UPDATE: scheduled_at + duration_min locked when confirmed + admin bypass
- `set_cancelled_at` — BEFORE UPDATE: auto-sets cancelled_at when status → cancelled/no_show
- `validate_session_type` — BEFORE INSERT/UPDATE: teacher must offer this session type in specialties
- `inc_teacher_sessions` — AFTER UPDATE WHEN completed: total_sessions+1 + revenue_recognized update
- `deduct_student_credit` — AFTER UPDATE WHEN pending→confirmed
- `restore_student_credit` — AFTER UPDATE WHEN confirmed→cancelled

**Indexes**:
```sql
CREATE INDEX idx_bookings_teacher_sched ON bookings(teacher_id, scheduled_at)
  WHERE status NOT IN('cancelled','no_show');  -- partial index
CREATE INDEX idx_bookings_student ON bookings(student_id);
CREATE INDEX idx_bookings_status  ON bookings(status);
```

**RLS**:
- SELECT: `auth.uid() = student_id OR auth.uid() = teacher_id OR is_admin()`
- INSERT: `auth.uid() = student_id OR is_admin()`
- UPDATE: `auth.uid() = student_id OR auth.uid() = teacher_id OR is_admin()`

---

## TABLE 11 — sessions

Daily.co video session — one per confirmed booking.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| booking_id | uuid | UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE | |
| room_name | text | UNIQUE NOT NULL DEFAULT ('furqan-'\|\|REPLACE(uuid_generate_v4()::text,'-','')) | Auto-generated |
| room_url | text | NOT NULL | Daily.co URL |
| expires_at | timestamptz | | Daily.co room expiry |
| created_via | text | NOT NULL DEFAULT 'auto' CHECK(IN('webhook','manual','auto')) | |
| started_at | timestamptz | | Actual start time |
| ended_at | timestamptz | | CHECK > started_at |
| actual_duration | integer | | Minutes — AUTO calculated by trigger |
| recording_url | text | | |
| teacher_joined | boolean | NOT NULL DEFAULT false | |
| student_joined | boolean | NOT NULL DEFAULT false | |
| post_session_notes | text | | Teacher notes after session |
| homework | text | | Assigned to student |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |
| admin_observer_id | uuid | REFERENCES profiles(id) | V9: observer currently watching |
| is_observable | boolean | DEFAULT true | V9: can admin/mod observe |
| observer_joined_at | timestamptz | | V9: when observer joined |
| observer_notes | text | | V9: observer's notes |

**Constraint**: CHECK(ended_at IS NULL OR started_at IS NULL OR ended_at > started_at)
**Trigger**: `guard_session` — BEFORE INSERT: raises exception if booking not confirmed/completed
**Trigger**: `calc_actual_duration` — BEFORE INSERT/UPDATE: ROUND(EPOCH FROM ended_at-started_at)/60
**RLS**:
- SELECT: booking_id IN (SELECT id FROM bookings WHERE student_id=auth.uid() OR teacher_id=auth.uid())

---

## TABLE 12 — conversations

One conversation per student-teacher pair.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| student_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| teacher_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| initiated_by | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| status | text | NOT NULL DEFAULT 'active' CHECK(IN('active','archived')) | |
| last_message_at | timestamptz | | AUTO via trigger |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Constraints**: UNIQUE(student_id, teacher_id) · CHECK(student_id != teacher_id)
**Indexes**: (student_id, last_message_at DESC) · (teacher_id, last_message_at DESC)
**RLS**:
- SELECT: `auth.uid() = student_id OR auth.uid() = teacher_id`
- INSERT: `auth.uid() = student_id OR auth.uid() = teacher_id`

---

## TABLE 13 — messages

Messages within conversations — realtime via Supabase.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| conversation_id | uuid | NOT NULL REFERENCES conversations(id) ON DELETE CASCADE | |
| sender_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| content | text | NOT NULL CHECK(LENGTH(content) BETWEEN 1 AND 5000) | |
| msg_type | msg_type | NOT NULL DEFAULT 'text' | text\|audio\|file |
| file_url | text | | Supabase Storage |
| is_read | boolean | NOT NULL DEFAULT false | |
| edited_at | timestamptz | | NULL = never edited |
| deleted_at | timestamptz | | Soft delete |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Trigger**: `sync_conv_ts` — AFTER INSERT: updates conversations.last_message_at
**Index**: (conversation_id, created_at)
**RLS**:
- SELECT: deleted_at IS NULL AND conversation_id IN (own conversations)
- INSERT: auth.uid() = sender_id AND conversation_id IN (own conversations)
- UPDATE: auth.uid() = sender_id AND deleted_at IS NULL

---

## TABLE 14 — student_progress

Append-only snapshots — one record per booking, never updated.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| student_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| teacher_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| booking_id | uuid | NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT | |
| progress_type | text | NOT NULL DEFAULT 'new' CHECK(IN('new','muraja','correction')) | V8 addition |
| surah_from | integer | CHECK(BETWEEN 1 AND 114) | |
| ayah_from | integer | | |
| surah_to | integer | CHECK(BETWEEN 1 AND 114) | |
| ayah_to | integer | | |
| pages_reviewed | integer | CHECK(>= 0) | V8 addition |
| quality_rating | integer | CHECK(BETWEEN 1 AND 5) | V8 addition — teacher grades recitation |
| level | student_level | NOT NULL DEFAULT 'beginner' | |
| teacher_notes | text | | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | Append-only — NEVER update this row |

**Constraints**:
```sql
CONSTRAINT unique_progress_per_booking UNIQUE(student_id, booking_id)
CONSTRAINT valid_progress_range CHECK(
  (surah_from IS NULL AND surah_to IS NULL) OR
  (surah_from IS NOT NULL AND surah_to IS NOT NULL AND (
    surah_to > surah_from OR
    (surah_to = surah_from AND
     ayah_from IS NOT NULL AND ayah_to IS NOT NULL AND
     ayah_to >= ayah_from)
  ))
)
```

**Index**: (student_id, created_at DESC)
**RLS**:
- SELECT: `auth.uid() = student_id OR auth.uid() = teacher_id OR is_admin()`
- INSERT: `auth.uid() = teacher_id OR is_admin()`

---

## TABLE 15 — recitation_errors *(V8 NEW)*

Specific tajweed/recitation errors per session.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| progress_id | uuid | NOT NULL REFERENCES student_progress(id) ON DELETE CASCADE | |
| surah_num | integer | CHECK(BETWEEN 1 AND 114) | |
| ayah_num | integer | NOT NULL | |
| error_type | text | NOT NULL CHECK(IN('makharij','sifat','madd','waqf','ghunna','other')) | |
| note | text | | Detailed description |
| resolved | boolean | NOT NULL DEFAULT false | |
| resolved_at | timestamptz | | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Index**: (progress_id, resolved)
**RLS**:
- SELECT: progress_id IN (SELECT id FROM student_progress WHERE student_id=auth.uid() OR teacher_id=auth.uid())
- INSERT: progress_id IN (SELECT id FROM student_progress WHERE teacher_id=auth.uid())
- UPDATE: progress_id IN (SELECT id FROM student_progress WHERE teacher_id=auth.uid())

---

## TABLE 16 — reviews

One review per completed booking.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| booking_id | uuid | UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT | |
| student_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| teacher_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| rating | integer | NOT NULL CHECK(BETWEEN 1 AND 5) | |
| comment | text | | Student writes |
| teacher_reply | text | | Teacher writes |
| is_public | boolean | NOT NULL DEFAULT true | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Trigger**: `update_teacher_rating` — AFTER INSERT/UPDATE/DELETE:
```sql
UPDATE teacher_profiles
SET rating_avg = COALESCE((SELECT ROUND(AVG(rating)::numeric,2) FROM reviews WHERE teacher_id=t_id), 0)
WHERE teacher_id = t_id;
```
**Index**: (teacher_id, created_at DESC)
**RLS**:
- SELECT: `is_public = true`
- INSERT: `auth.uid() = student_id AND (SELECT status FROM bookings WHERE id=booking_id) = 'completed'`
- UPDATE (student): rating immutable — `WITH CHECK(rating = OLD.rating)`
- UPDATE (teacher): teacher_reply only — `USING(auth.uid() = teacher_id)`

---

## TABLE 17 — notifications

In-app + email + push — realtime via Supabase.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| user_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE CASCADE | |
| type | notif_type | NOT NULL | |
| channel | text[] | NOT NULL DEFAULT '{in_app}' CHECK(channel <@ ARRAY['in_app','email','push']) | Array — NOT single text |
| title | text | NOT NULL | |
| body | text | | |
| data | jsonb | | Expected keys: booking_id UUID, session_id UUID, teacher_id UUID |
| is_read | boolean | NOT NULL DEFAULT false | |
| expires_at | timestamptz | DEFAULT (NOW() + INTERVAL '30 days') | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**pg_cron**: `DELETE FROM notifications WHERE expires_at < NOW()` — daily at 02:00 UTC
**Index**: (user_id, is_read, created_at DESC)
**RLS**:
- ALL: `auth.uid() = user_id`

---

## TABLE 18 — invoices *(V8 NEW)*

Official invoices — FURQAN-2026-00001 format.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| payment_id | uuid | UNIQUE NOT NULL REFERENCES payments(id) ON DELETE RESTRICT | |
| student_id | uuid | NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT | |
| invoice_number | text | UNIQUE NOT NULL | AUTO via trigger + SEQUENCE |
| issued_at | timestamptz | NOT NULL DEFAULT NOW() | |
| pdf_url | text | | Supabase Storage |
| student_name_snapshot | text | NOT NULL | Locked at issue time |
| amount_usd | numeric(10,2) | NOT NULL | |
| tax_amount | numeric(10,2) | NOT NULL DEFAULT 0 | |
| currency | text | NOT NULL | |
| exchange_rate_snapshot | numeric(10,6) | | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Sequence**: `CREATE SEQUENCE invoice_seq START WITH 1`
**Trigger**: `gen_invoice_number` — BEFORE INSERT:
```sql
NEW.invoice_number := 'FURQAN-' || to_char(NOW(),'YYYY') || '-' || LPAD(nextval('invoice_seq')::text, 5, '0');
```
**RLS**:
- SELECT: `auth.uid() = student_id OR is_admin()`

---

## TABLE 19 — audit_log *(V8 NEW)*

Immutable log of all sensitive operations.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT uuid_generate_v4() | |
| changed_by | uuid | REFERENCES profiles(id) ON DELETE SET NULL | |
| table_name | text | NOT NULL | |
| record_id | uuid | NOT NULL | |
| action | text | NOT NULL CHECK(IN('INSERT','UPDATE','DELETE')) | |
| old_data | jsonb | | State before change |
| new_data | jsonb | | State after change |
| reason | text | | Required for admin overrides |
| ip_address | text | | |
| created_at | timestamptz | NOT NULL DEFAULT NOW() | |

**Indexes**: (table_name, record_id) · (created_at DESC)
**RLS**:
- SELECT: `is_admin()`
- INSERT: system/service_role only

---

## TABLE 20 — schema_migrations *(V8 NEW)*

Schema version tracking.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| version | text | PK | e.g. v8.0.0 |
| applied_at | timestamptz | NOT NULL DEFAULT NOW() | |
| description | text | | |
| applied_by | text | | |

**Seed**:
```sql
INSERT INTO schema_migrations VALUES
  ('v7.0.0', NOW(), 'Absolute Final — all triggers locked', 'system'),
  ('v8.0.0', NOW(), 'Domain Expert — Quran + Schema + Accounting', 'system');
```
**RLS**:
- SELECT: `is_admin()`

---

## TABLE 21 — platform_settings *(V9 NEW)*

Key-value store for feature flags and platform configuration.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| key | text | PK | e.g. 'hide_reviews', 'hide_prices' |
| value | text | NOT NULL DEFAULT '' | |
| description | text | | |
| updated_at | timestamptz | DEFAULT NOW() | |
| updated_by | uuid | REFERENCES profiles(id) | |

**Seed**: `hide_reviews=true`, `hide_prices=true`
**RLS**:
- SELECT: `true` (anyone can read)
- ALL: `is_admin_or_mod()`

---

## TABLE 22 — session_evaluations *(V9 NEW)*

Student evaluation scores by admin/moderator.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT gen_random_uuid() | |
| student_id | uuid | NOT NULL REFERENCES profiles(id) | |
| teacher_id | uuid | NOT NULL REFERENCES profiles(id) | |
| evaluator_id | uuid | NOT NULL REFERENCES profiles(id) | admin/mod who created |
| evaluation_type | evaluation_type | NOT NULL | weekly/biweekly/monthly/quarterly |
| period_start | date | NOT NULL | |
| period_end | date | NOT NULL | |
| hifz_score | smallint | CHECK(BETWEEN 1 AND 10) | |
| tajweed_score | smallint | CHECK(BETWEEN 1 AND 10) | |
| akhlaq_score | smallint | CHECK(BETWEEN 1 AND 10) | |
| attendance_score | smallint | CHECK(BETWEEN 1 AND 10) | |
| overall_score | smallint | CHECK(BETWEEN 1 AND 10) | |
| strengths | text | | |
| weaknesses | text | | |
| recommendations | text | | |
| notes | text | | |
| created_at | timestamptz | DEFAULT NOW() | |
| updated_at | timestamptz | DEFAULT NOW() | |

**RLS**:
- ALL: `is_admin_or_mod()`
- SELECT: `teacher_id = auth.uid()` (teacher reads own)
- SELECT: `student_id = auth.uid()` (student reads own)

---

## TABLE 23 — parent_reports *(V9 NEW)*

Reports sent to parents/guardians.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT gen_random_uuid() | |
| student_id | uuid | NOT NULL REFERENCES profiles(id) | |
| teacher_id | uuid | REFERENCES profiles(id) | |
| report_type | report_type | NOT NULL | session_summary/evaluation/custom/missed_session/schedule_change |
| title | text | NOT NULL | |
| body | text | NOT NULL | |
| sent_to_email | text | | |
| sent_to_phone | text | | |
| sent_at | timestamptz | | NULL until actually sent |
| created_by | uuid | NOT NULL REFERENCES profiles(id) | |
| created_at | timestamptz | DEFAULT NOW() | |

**RLS**:
- ALL: `is_admin_or_mod()`
- SELECT: `teacher_id = auth.uid()`

---

## TABLE 24 — session_notes_history *(V9 NEW)*

Audit trail for session notes edits.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT gen_random_uuid() | |
| session_id | uuid | NOT NULL REFERENCES sessions(id) | |
| notes | text | NOT NULL | |
| saved_by | uuid | NOT NULL REFERENCES profiles(id) | |
| created_at | timestamptz | DEFAULT NOW() | |

**RLS**:
- ALL: `is_admin_or_mod()`
- SELECT: `saved_by = auth.uid()`

---

## TABLE 25 — session_observers *(V9 NEW)*

Tracks who observed which session.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK DEFAULT gen_random_uuid() | |
| session_id | uuid | NOT NULL REFERENCES sessions(id) | |
| observer_id | uuid | NOT NULL REFERENCES profiles(id) | |
| joined_at | timestamptz | | |
| left_at | timestamptz | | |
| notes | text | | |
| created_at | timestamptz | DEFAULT NOW() | |

**RLS**:
- ALL: `is_admin_or_mod()`

---

## SHARED FUNCTIONS & TRIGGERS

### set_updated_at()
Applied to: profiles, teacher_profiles
```sql
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
```

### is_admin() — Secure admin check
```sql
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND deleted_at IS NULL
      AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```
Used in: all lock triggers, status transition trigger, RLS policies.

### is_moderator() *(V9 NEW)*
```sql
CREATE OR REPLACE FUNCTION is_moderator() RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'moderator'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

### is_admin_or_mod() *(V9 NEW)*
```sql
CREATE OR REPLACE FUNCTION is_admin_or_mod() RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'moderator')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```
Used in: V9 RLS policies for evaluations, reports, observers, settings.

---

## REALTIME SUBSCRIPTIONS

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
```

---

## CIRCULAR FK SOLUTION

`payments.booking_id` references `bookings.id` but `bookings` is created after `payments`.

**Solution**: Create `payments.booking_id` without REFERENCES, then add FK after `bookings` exists:
```sql
-- In CREATE TABLE payments: booking_id UUID UNIQUE  (no REFERENCES)
-- After bookings is created:
ALTER TABLE payments ADD CONSTRAINT fk_payments_booking
  FOREIGN KEY(booking_id) REFERENCES bookings(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;
```

---

## BUSINESS RULES

1. `rate_snapshot` — locked at booking creation, immutable (admin bypass available)
2. `refund_policy_id` — locked after first set, immutable (admin bypass available)
3. `scheduled_at` + `duration_min` — locked when booking is confirmed
4. `amount_usd` — calculated in app as `rate_snapshot × (duration_min / 60.0)`, stored as fact
5. `actual_duration` — auto-calculated: `ROUND(EPOCH FROM ended_at - started_at) / 60`
6. `cancelled_at` — auto-set by trigger when status → cancelled or no_show
7. `revenue_recognized` — increases by `rate_snapshot × (duration_min/60)` on booking → completed
8. `student_credits.used` — auto-deducted on confirmed, auto-restored on cancelled
9. `remaining credits` — always `total - used` computed in query, NEVER stored
10. `invoice_number` — auto: `FURQAN-{YYYY}-{NNNNN}` via SEQUENCE
11. `room_name` — auto: `furqan-{uuid-no-dashes}`
12. Session guard — cannot create session for pending/cancelled bookings
13. session_type validation — teacher.specialties must include requested type
14. Reviews — only for completed bookings; rating immutable after submit
15. Soft deletes — use `deleted_at` / `is_archived` — NEVER hard delete user data
16. Admin bypass — is_admin() allows overriding all immutable locks
17. V9: Teacher CV workflow — draft → pending_review → approved/rejected (by admin/mod)
18. V9: Auto-decline — confirming a booking auto-cancels overlapping pending bookings for same teacher
19. V9: teacher_confirmed — explicit confirmation flag + timestamp on booking
20. V9: Session observation — admin/mod can join as observer (mic/camera off, max_participants bumped to 3)
21. V9: Feature flags — platform_settings table controls UI visibility (reviews, prices)
22. V9: Parent reports — created on session complete, evaluation, no-show (email/SMS integration pending)
23. V9: Moderator — same as admin but cannot manage admins, create users, or access settings

---

## MULTI-CURRENCY

```
amount_usd      — base for all accounting (always USD)
amount_local    — display only, not used in calculations
local_currency  — must be UPPER case (KWD, SAR, EGP, AED, MAD, QAR, USD)
exchange_rate_snapshot — locked at transaction time, never changes
```

---

## TAX HANDLING

```
amount_usd = amount_before_tax + tax_amount
tax_amount = amount_before_tax × (tax_rate / 100)
```

| Country | Rate |
|---------|------|
| Saudi Arabia | 15% VAT |
| Egypt | 14% VAT |
| UAE | 5% VAT |
| Kuwait | 0% |

---

## QURAN DOMAIN REFERENCE

### Recitation Standards (Riwayat)
| Code | Arabic | Common Region |
|------|--------|---------------|
| hafs | حفص عن عاصم | Global (most common) |
| warsh | ورش عن نافع | North Africa |
| qalon | قالون عن نافع | Libya, Tunisia |
| al_duri | الدوري عن أبي عمرو | Sudan, parts of Africa |
| shu_ba | شعبة عن عاصم | Rare |

### Session Types
| Code | Arabic | Description |
|------|--------|-------------|
| hifz | حفظ جديد | New memorization |
| muraja | مراجعة | Revision of previously memorized |
| tajweed | تجويد نظري | Tajweed rules theory |
| tilawa | تصحيح تلاوة | Recitation correction |
| qiraat | القراءات | The ten readings |
| tafsir | تفسير | Quranic interpretation |
| combined | حفظ + مراجعة | Both hifz and muraja |
| other | أخرى | Other |

### Recitation Error Types
| Code | Arabic | Description |
|------|--------|-------------|
| makharij | مخارج الحروف | Letter articulation points |
| sifat | صفات الحروف | Letter characteristics |
| madd | المدود | Elongations |
| waqf | الوقف والابتداء | Stopping and starting rules |
| ghunna | الغنة | Nasalization |
| other | أخرى | Other errors |

---

## ENVIRONMENT VARIABLES

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

DAILY_API_KEY=

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## FOLDER STRUCTURE

```
src/
├── app/
│   ├── (auth)/           — login, register, forgot-password
│   ├── (public)/         — landing, about, contact, packages, teachers, blog, services
│   ├── admin/
│   │   ├── dashboard/
│   │   ├── users/        — list + new (from-scratch creation)
│   │   ├── teachers/     — list + cv review queue
│   │   ├── bookings/
│   │   ├── sessions/     — list + live monitor + [id]/observe
│   │   ├── evaluations/  — list + new
│   │   ├── payments/
│   │   ├── reviews/
│   │   ├── blog/
│   │   └── settings/     — health check + feature flags
│   ├── moderator/        — V9 NEW
│   │   ├── dashboard/
│   │   ├── users/        — students + teachers only
│   │   ├── cv-review/    — CV approval queue + detail
│   │   ├── sessions/     — list + [id]/observe
│   │   ├── evaluations/  — list + new
│   │   └── audit/        — read-only audit log
│   ├── student/
│   │   ├── dashboard/
│   │   ├── teachers/
│   │   ├── bookings/     — list + new
│   │   ├── sessions/     — list + [id] with video room
│   │   ├── progress/
│   │   └── messages/
│   ├── teacher/
│   │   ├── dashboard/    — booking actions + session controls
│   │   ├── sessions/
│   │   ├── availability/
│   │   ├── students/     — list + [studentId] with enhanced file
│   │   ├── cv/           — V9 NEW — CV form + submit for review
│   │   ├── evaluations/  — V9 NEW — read-only evaluations
│   │   └── messages/
│   └── api/
│       ├── stripe/webhook/
│       └── bookings/
├── components/
│   ├── shared/           — nav, session-timer, session-status, device-check
│   └── public/           — testimonials, public-nav, public-footer
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   ├── server.ts
│   │   ├── middleware.ts
│   │   └── admin.ts      — V9 NEW — service-role client
│   ├── actions/
│   │   └── evaluations.ts — V9 NEW — shared admin+moderator actions
│   ├── notifications/
│   │   └── parent.ts      — V9 NEW — parent report system
│   ├── i18n/             — context + lang-toggle
│   ├── daily.ts          — rooms, tokens, observer tokens
│   ├── settings.ts       — V9 NEW — feature flag utilities
│   ├── feature-flags-context.tsx — V9 NEW — client-side flags
│   └── constants.ts
├── types/
│   └── database.ts       — 25 tables, 11 enums, 3 SQL functions
└── proxy.ts              — route protection middleware
supabase/
└── functions/             — V9 NEW — 4 edge functions
    ├── auto-reminder/
    ├── auto-complete/
    ├── no-show-detector/
    └── weekly-report/
```

---

## IMPLEMENTATION STATUS

All phases complete as of V9.

```
✅ Phase 1A — Foundation (auth, types, middleware, routing)
✅ Phase 1B — Teacher Side (profile, availability, dashboard)
✅ Phase 1C — Student Side (teachers, booking, payments, dashboard)
✅ Phase 1D — Sessions (Daily.co rooms, video, notes)
✅ Phase 1E — Progress & Communication (progress, errors, messaging, notifications)
✅ Phase 1F — Admin (14 management pages)
✅ Phase 2  — Session Controls (device check, timer, force-end, no-show, extend room)
✅ Phase 3  — Security (meeting tokens, time windows, rate limiting, availability validation)
✅ Phase 4  — E2E Tests (Playwright, 6 tests passing)
✅ V9.0 — Moderator role + CV workflow
✅ V9.1 — Admin from-scratch user creation
✅ V9.2 — Evaluation system
✅ V9.3 — Booking auto-decline on overlap
✅ V9.4 — Session observation (admin/mod)
✅ V9.5 — Parent notifications
✅ V9.6 — Feature flags (hide_reviews, hide_prices)
✅ V9.7 — Student file enhancement
✅ V9.8 — AI automations (4 edge functions)
```

## PENDING (requires manual action)
- Run `src/lib/supabase/migrations/v9_001_schema.sql` against Supabase
- Configure cron schedules for edge functions in Supabase dashboard
- Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel env (already done)
