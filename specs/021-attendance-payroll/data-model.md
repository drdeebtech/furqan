# Data Model: Attendance, Excuses & Teacher Payroll (Spec 021)

**Phase**: م٤ | **Generated**: 2026-06-16

Spec 021 introduces 5 new tables. All reuse spec 018/019/020 conventions: `(select auth.uid())` initplan RLS, `private.is_admin()`, `public.set_updated_at()`, `BEFORE UPDATE OF` identity guards, service-role-only financial writes.

---

## New Tables

### `subscription_extensions` (Phase 0 — introduced first)

Accumulates carry-over extension grants without mutating `subscriptions.current_period_end`.

```sql
CREATE TABLE subscription_extensions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id     uuid NOT NULL REFERENCES subscriptions(id),
  booking_id          uuid NOT NULL REFERENCES bookings(id),  -- idempotency anchor (always present)
  session_id          uuid REFERENCES sessions(id),  -- informational audit link; nullable
  granted_by_user_id  uuid NOT NULL REFERENCES profiles(id),
  reason              text NOT NULL,
  extension_seconds   bigint NOT NULL CHECK (extension_seconds > 0),
  granted_at          timestamptz NOT NULL DEFAULT now()
);
-- Idempotency anchored on booking_id: session_id is nullable on bookings (verified 2026-06-16),
-- so it cannot guarantee one-grant-per-event for individual sessions.
CREATE UNIQUE INDEX uix_subscription_extensions_booking
  ON subscription_extensions(subscription_id, booking_id);
CREATE INDEX idx_subscription_extensions_sub ON subscription_extensions(subscription_id);
```

**RLS**:
- SELECT: student reads own (`subscription_id IN (SELECT id FROM subscriptions WHERE student_id = (select auth.uid()))`); admin reads all.
- INSERT/UPDATE/DELETE: service_role only.

**BEFORE UPDATE OF** (`extension_seconds`, `subscription_id`, `booking_id`, `session_id`) — immutable after insert.

**Effective period end** (computed on read):
```sql
SELECT current_period_end + make_interval(secs => COALESCE(SUM(extension_seconds), 0))
FROM subscriptions s
LEFT JOIN subscription_extensions e ON e.subscription_id = s.id
WHERE s.id = :sub_id;
```
`COALESCE(..., 0)` is required: `SUM` over an empty join returns NULL, and `timestamptz + make_interval(secs => NULL)` is NULL — a subscription with no extensions would silently lose its period end.

---

### `attendance_records`

One finalized outcome per booking.

```sql
CREATE TYPE attendance_outcome AS ENUM (
  'present', 'student_absent', 'teacher_absent', 'excused_carried'
);
CREATE TYPE credit_action AS ENUM ('none', 'debited', 'restored');

CREATE TABLE attendance_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL UNIQUE REFERENCES bookings(id),
  student_id   uuid NOT NULL REFERENCES profiles(id),
  teacher_id   uuid NOT NULL REFERENCES profiles(id),  -- originally assigned teacher (the absent teacher if teacher_absent; actual deliverer recorded in session_deliveries)
  session_id   uuid REFERENCES sessions(id),
  outcome      attendance_outcome NOT NULL,
  credit_action credit_action NOT NULL DEFAULT 'none',
  finalized_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_attendance_student ON attendance_records(student_id);
CREATE INDEX idx_attendance_teacher ON attendance_records(teacher_id);
SELECT public.set_updated_at('attendance_records');
```

**RLS**:
- SELECT: student reads own (`student_id = (select auth.uid())`); teacher reads where `teacher_id = (select auth.uid())`; admin reads all.
- INSERT/UPDATE on `outcome`, `credit_action`, `finalized_at`: service_role only (via `finalize_attendance` fn).

**BEFORE UPDATE OF** (`booking_id`, `student_id`) — identity guard.

---

### `excuse_requests`

One excuse per booking (unique constraint). Eligibility computed at submission time.

```sql
CREATE TYPE excuse_status AS ENUM ('pending', 'accepted', 'rejected', 'ineligible');

CREATE TABLE excuse_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  student_id  uuid NOT NULL REFERENCES profiles(id),
  teacher_id  uuid NOT NULL REFERENCES profiles(id),  -- the deciding teacher
  reason      text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  is_eligible boolean NOT NULL,  -- set at submission from threshold check
  status      excuse_status NOT NULL DEFAULT 'pending',
  decided_by  uuid REFERENCES profiles(id),
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uix_excuse_per_booking ON excuse_requests(booking_id);
CREATE INDEX idx_excuse_student ON excuse_requests(student_id);
CREATE INDEX idx_excuse_teacher ON excuse_requests(teacher_id);
```

**RLS**:
- SELECT: student reads own; teacher reads where `teacher_id = (select auth.uid())`; admin reads all.
- INSERT: authenticated student for their own upcoming sessions only (`student_id = (select auth.uid())`).
- UPDATE on `status`, `decided_by`, `decided_at`: teacher where `teacher_id = (select auth.uid())` and status = 'pending'; admin all.

**BEFORE UPDATE OF** (`booking_id`, `student_id`, `teacher_id`) — identity guard. `is_eligible` immutable after insert.

---

### `session_deliveries`

Per-session payroll tracking with rate snapshot.

```sql
CREATE TABLE session_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES sessions(id),
  teacher_id          uuid NOT NULL REFERENCES profiles(id),  -- actual deliverer
  duration_minutes    integer NOT NULL CHECK (duration_minutes > 0),
  hourly_rate_usd     numeric(10,2) NOT NULL CHECK (hourly_rate_usd >= 0),
  delivered_at        timestamptz NOT NULL,
  payroll_period_month date NOT NULL,  -- first day of month UTC (date_trunc('month', delivered_at))
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uix_session_deliveries_session ON session_deliveries(session_id);
CREATE INDEX idx_session_deliveries_teacher_month
  ON session_deliveries(teacher_id, payroll_period_month);
```

**RLS**:
- SELECT: teacher reads own (`teacher_id = (select auth.uid())`); admin reads all.
- INSERT: service_role only (inside `finalize_attendance` fn).
- UPDATE/DELETE: none (fully immutable after insert).

**BEFORE UPDATE OF** (`session_id`, `teacher_id`, `duration_minutes`, `hourly_rate_usd`, `delivered_at`) — all columns immutable.

---

### `teacher_payouts` (payout ledger)

One row per teacher per payroll month. Financial columns immutable after creation.

```sql
CREATE TYPE payout_status AS ENUM ('pending', 'paid', 'failed');

CREATE TABLE teacher_payouts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id           uuid NOT NULL REFERENCES profiles(id),
  payroll_period_month date NOT NULL,  -- first day of closed month
  total_hours          numeric(10,2) NOT NULL CHECK (total_hours >= 0),
  hourly_rate_usd      numeric(10,2) NOT NULL CHECK (hourly_rate_usd >= 0),
  total_amount_usd     numeric(10,2) NOT NULL CHECK (total_amount_usd >= 0),
  status               payout_status NOT NULL DEFAULT 'pending',
  run_at               timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uix_teacher_payouts_period
  ON teacher_payouts(teacher_id, payroll_period_month);
CREATE INDEX idx_teacher_payouts_teacher ON teacher_payouts(teacher_id);
```

**RLS**:
- SELECT: teacher reads own; admin reads all.
- INSERT: service_role only (via `run_monthly_payroll` fn).
- UPDATE on `status`: admin or service_role only.

**BEFORE UPDATE OF** (`teacher_id`, `payroll_period_month`, `total_hours`, `total_amount_usd`) — financial amounts immutable; only `status` may be updated by admin.

---

## SECURITY DEFINER Functions

### `finalize_attendance(p_booking_id uuid, p_outcome attendance_outcome, p_actual_teacher_id uuid DEFAULT NULL) RETURNS void`

Atomic outcome finalization:
1. Upsert `attendance_records` with outcome (conflicts on `booking_id` → idempotent).
2. If `excused_carried`: check `credit_action != 'restored'`, then call `restore_student_package(p_booking_id)`, update `credit_action = 'restored'`, insert `subscription_extensions` row (conflict on unique index → skip if already extended).
3. If `teacher_absent`: call `restore_student_package(p_booking_id)`, set `credit_action = 'restored'`. `attendance_records.teacher_id` = the originally-assigned (absent) teacher from the booking — **never NULL** (the column is `NOT NULL`). Any substitute deliverer is recorded on `session_deliveries.teacher_id` (step 4), not here.
4. If outcome is `present` or `teacher_absent` with deliverer: insert `session_deliveries` row (hourly_rate_usd snapshot from teacher profile; conflict on unique index → skip).
5. SET search_path = public; SECURITY DEFINER; REVOKE EXECUTE FROM public, anon, authenticated; GRANT EXECUTE TO service_role.

### `run_monthly_payroll(p_month date) RETURNS int`

Idempotent monthly aggregation. Two correctness guards are part of the contract:

- **FR-029 (constant rate per teacher/month):** `MAX(hourly_rate_usd)` is the effective rate **only** if every row for the teacher/month shares one snapshotted rate. The run MUST detect non-uniform rates (`MIN(hourly_rate_usd) <> MAX(hourly_rate_usd)`) rather than silently pick `MAX` — those teacher/months are surfaced as exceptions, not paid.
- **FR-030 (fail loud on missing/zero rate):** a teacher/month whose effective rate is `NULL` or `0` MUST NOT yield a silent `$0` payout — it is skipped and surfaced.

```sql
-- Only well-formed teacher/months become payouts: uniform, positive rate.
WITH agg AS (
  SELECT
    teacher_id,
    ROUND(SUM(duration_minutes) / 60.0, 2)                         AS total_hours,
    MAX(hourly_rate_usd)                                           AS rate_max,
    MIN(hourly_rate_usd)                                           AS rate_min,
    ROUND(SUM(duration_minutes / 60.0 * hourly_rate_usd), 2)       AS total_amount_usd
  FROM session_deliveries
  WHERE payroll_period_month = p_month
  GROUP BY teacher_id
)
INSERT INTO teacher_payouts (teacher_id, payroll_period_month, total_hours, hourly_rate_usd, total_amount_usd)
SELECT teacher_id, p_month, total_hours, rate_max, total_amount_usd
FROM agg
WHERE rate_max IS NOT NULL AND rate_max > 0   -- FR-030: skip NULL/zero rate (surfaced separately)
  AND rate_min = rate_max                     -- FR-029: skip non-uniform rate (surfaced separately)
ON CONFLICT (teacher_id, payroll_period_month) DO NOTHING;

-- Exceptions surfaced for ops (RAISE WARNING per offending teacher/month, or return alongside the count):
--   rate_max IS NULL OR rate_max = 0  → missing/zero-rate exception (FR-030)
--   rate_min <> rate_max              → non-uniform-rate exception (FR-029)
```
Returns count of payout rows inserted. The well-formed teacher/months are paid; any `NULL`/`0`-rate or non-uniform-rate teacher/month is **skipped and surfaced**, never silently paid `$0`. Surfacing mechanism: the fn `RAISE WARNING`s per offending teacher/month (visible in run logs); the TS wrapper (`runMonthlyPayroll`, T022) additionally re-derives the structured `exceptions[]` (`{ teacherId, reason }`) returned by the API (contracts §5) by querying the same `agg` predicates, so ops get an actionable list rather than only a log line. SET search_path = public; SECURITY DEFINER; same EXECUTE lockdown.

---

## New platform_settings Keys

| Key | Seed value | Description |
|-----|-----------|-------------|
| `excuse_notice_threshold_seconds` | `'7200'` | 2 hours in seconds; excuse must be submitted this many seconds before session start |
| `payroll_run_day_of_month` | `'1'` | Day of month on which monthly payroll runs (1 = first of following month) |

---

## Migration Files

| File | Contents |
|------|----------|
| `20260619000000_profiles_hourly_rate.sql` | ALTER `profiles` ADD `hourly_rate_usd numeric(10,2)` (verified absent 2026-06-16; precondition for the rate snapshot) |
| `20260619000001_subscription_extensions.sql` | `subscription_extensions` table (booking_id anchor) + RLS + guard + seed platform_settings keys |
| `20260619000002_attendance_excuses.sql` | `attendance_outcome`/`credit_action`/`excuse_status` enums + `attendance_records` + `excuse_requests` + RLS + guards |
| `20260619000003_payroll_tables.sql` | `payout_status` enum + `session_deliveries` + `teacher_payouts` + RLS + guards |
| `20260619000004_attendance_payroll_fns.sql` | `finalize_attendance` + `run_monthly_payroll` SECURITY DEFINER fns |

> Timestamps are `20260619xxxxxx` so this spec's migrations sort strictly after spec 020's `20260618xxxxxx` set (resolves the prior 020↔021 collision).

---

## Entity Relationships

```
subscriptions ──< subscription_extensions (carry-over grants)

bookings ──── attendance_records (one per booking, finalized outcome)
          └── excuse_requests    (one per booking, student-submitted)

sessions ──── session_deliveries (one per delivered session, rate snapshot)

profiles(teacher) ──< session_deliveries
                  ──< teacher_payouts (one per teacher per month)
```

---

## Scale Audit (50k users)

| Table | Estimated rows | Index strategy |
|-------|---------------|----------------|
| `subscription_extensions` | ~30k/year | Unique on (subscription_id, booking_id) |
| `attendance_records` | ~600k/year | Unique on booking_id; idx on student_id, teacher_id |
| `excuse_requests` | ~30k/year | Unique on booking_id; idx on student_id, teacher_id |
| `session_deliveries` | ~600k/year | Unique on session_id; composite idx on (teacher_id, month) |
| `teacher_payouts` | ~120 rows/month | Unique on (teacher_id, month) — tiny |
