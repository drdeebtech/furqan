# Data Model: Scheduling, Fixed-Teacher Assignment & Cohorts (Spec 020)

**Phase**: م٣ | **Generated**: 2026-06-16

Specs 018/019 own: `subscriptions`, `subscription_plans`, `student_packages`, `billing_events`, `stripe_customers`, `packages`, `guardian_children`.
This spec **adds one new table** (`subscription_teacher_assignments`) and **reuses** five existing tables unchanged.

---

## 1. New Table: `subscription_teacher_assignments`

Binds a student to a teacher for an in-scope hifz subscription month.

```sql
CREATE TABLE subscription_teacher_assignments (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id                      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  teacher_id                      uuid        NOT NULL REFERENCES profiles(id),
  subscription_id                 uuid        NOT NULL REFERENCES subscriptions(id),
  product_type                    text        NOT NULL CHECK (product_type IN ('hifz_individual','hifz_group','course')),
  lock_month                      date        NOT NULL,   -- first day of the locked calendar month (e.g. 2026-07-01)
  is_active                       boolean     NOT NULL DEFAULT true,
  approved_by                     uuid        REFERENCES profiles(id),  -- NULL = renewal; set = admin mid-month approval
  cancelled_future_bookings_at    timestamptz,            -- set when admin change resolves future bookings
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- Trigger: keep updated_at current
CREATE TRIGGER set_updated_at_sta
  BEFORE UPDATE ON subscription_teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Partial unique: one active assignment per student
CREATE UNIQUE INDEX uix_sta_student_active
  ON subscription_teacher_assignments(student_id)
  WHERE is_active = true;

-- Lookup indexes
CREATE INDEX idx_sta_student  ON subscription_teacher_assignments(student_id)  WHERE is_active;
CREATE INDEX idx_sta_teacher  ON subscription_teacher_assignments(teacher_id)  WHERE is_active;
```

### Column Reference

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | gen_random_uuid() |
| `student_id` | `uuid NOT NULL FK profiles` | ON DELETE CASCADE |
| `teacher_id` | `uuid NOT NULL FK profiles` | The assigned teacher |
| `subscription_id` | `uuid NOT NULL FK subscriptions` | The spec-018/019 subscription granting eligibility |
| `product_type` | `text CHECK(...)` | `hifz_individual` / `hifz_group` / `course` |
| `lock_month` | `date NOT NULL` | First day of locked month; enforces renewal-only change |
| `is_active` | `boolean DEFAULT true` | Only one true row per student (partial unique index) |
| `approved_by` | `uuid FK profiles NULL` | Admin uid if mid-month admin change; NULL at renewal |
| `cancelled_future_bookings_at` | `timestamptz NULL` | Set after admin change resolves future bookings |
| `created_at` | `timestamptz` | Immutable |
| `updated_at` | `timestamptz` | Auto-updated by trigger |

### RLS Policies

```sql
ALTER TABLE subscription_teacher_assignments ENABLE ROW LEVEL SECURITY;

-- Students read their own
CREATE POLICY "sta_student_select" ON subscription_teacher_assignments
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

-- Teachers read assignments where they are assigned
CREATE POLICY "sta_teacher_select" ON subscription_teacher_assignments
  FOR SELECT TO authenticated
  USING (teacher_id = (SELECT auth.uid()));

-- Admins/mods read all
CREATE POLICY "sta_admin_select" ON subscription_teacher_assignments
  FOR SELECT TO authenticated
  USING (private.is_admin_or_mod());

-- Only service_role may INSERT
CREATE POLICY "sta_service_insert" ON subscription_teacher_assignments
  FOR INSERT TO service_role WITH CHECK (true);

-- service_role and admin session may UPDATE allowed columns
CREATE POLICY "sta_service_update" ON subscription_teacher_assignments
  FOR UPDATE TO service_role USING (true);

CREATE POLICY "sta_admin_update" ON subscription_teacher_assignments
  FOR UPDATE TO authenticated
  USING (private.is_admin());
```

### BEFORE UPDATE Identity Guard

```sql
CREATE OR REPLACE FUNCTION guard_sta_identity_cols()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.student_id <> NEW.student_id
  OR OLD.subscription_id <> NEW.subscription_id
  OR OLD.product_type <> NEW.product_type
  OR OLD.lock_month <> NEW.lock_month THEN
    RAISE EXCEPTION 'subscription_teacher_assignments: identity columns are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sta_identity_guard
  BEFORE UPDATE OF student_id, subscription_id, product_type, lock_month
  ON subscription_teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_sta_identity_cols();
```

---

## 2. Reused Tables (No Structural Changes)

These tables are consumed as-is. This spec adds server-side constraints and a new domain function — not schema modifications.

### 2a. `teacher_availability`

Recurring weekly slots published by a teacher.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `teacher_id` | `uuid FK profiles` | |
| `day_of_week` | `int` | 0=Sunday..6=Saturday |
| `start_time` | `time` | Slot start |
| `end_time` | `time` | Slot end |
| `slot_duration_min` | `int` | Duration in minutes |
| `is_active` | `boolean` | Whether the slot is published |
| `is_booked` | `boolean DEFAULT false` | Set to true when a booking is created for this slot |

**This spec adds**: the `FOR UPDATE` lock pattern on `is_booked` before booking (R-004); no DDL change.

### 2b. `bookings`

Session reservations. Existing identity guards (`20260613140000`, `20260612120004`) stay intact.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `student_id` | `uuid FK profiles` | From `auth.getUser()` |
| `teacher_id` | `uuid FK profiles` | Must equal assigned teacher (server check) |
| `student_package_id` | `uuid FK student_packages` | Credit link |
| `class_offering_id` | `uuid FK class_offerings NULL` | For group/cohort bookings |
| `session_id` | `uuid FK sessions NULL` | |
| `scheduled_at` | `timestamptz` | |
| `status` | `text` | `pending`/`confirmed`/`completed`/`cancelled`/`no_show` |

**This spec adds**: server-side check that `teacher_id = assignment.teacher_id` before INSERT. No DDL change.

### 2c. `class_offerings`

Group/halaqa/course definitions with fixed schedules.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid PK` | |
| `teacher_id` | `uuid FK profiles` | Assigned teacher |
| `program_level` | `text` | Juz/level identifier used for sibling matching |
| `capacity` | `int` | Max members |
| `current_enrollment` | `int DEFAULT 0` | Incremented on join |
| `status` | `text` | `open`/`full`/`confirmed`/`cancelled`/`completed` |
| `schedule_json` | `jsonb` | Fixed weekly schedule (days + times) |
| `session_duration_min` | `int` | |
| `start_date` | `date` | |

**This spec adds**: `open_overflow_halaqa()` SECURITY DEFINER fn that may INSERT new rows (R-003).

### 2d. `sessions`

Individual session instances within a class offering.

| Column | Type | Notes |
|--------|------|-------|
| `session_mode` | `text` | `private`/`halaqa`/`lecture` |
| `capacity` | `int` | |
| `current_enrollment` | `int` | |
| `min_participants` | `int` | Can start below this (no blocking minimum per FR-014) |

### 2e. `session_participants`

Cohort membership. Gated by `session_participant_secdef` (migration `20260613120000`).

---

## 3. SECURITY DEFINER Function: `open_overflow_halaqa`

```sql
CREATE OR REPLACE FUNCTION open_overflow_halaqa(p_source_offering_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sibling_id uuid;
  v_new_id     uuid;
  v_source     class_offerings%ROWTYPE;
BEGIN
  SELECT * INTO v_source
  FROM class_offerings
  WHERE id = p_source_offering_id
  FOR SHARE;

  -- prefer not-full sibling (same juz/level + teacher)
  SELECT id INTO v_sibling_id
  FROM class_offerings
  WHERE teacher_id        = v_source.teacher_id
    AND program_level     = v_source.program_level
    AND status            = 'open'
    AND current_enrollment < capacity
    AND id                <> p_source_offering_id
  ORDER BY current_enrollment DESC  -- fill least-empty sibling first
  LIMIT 1;

  IF v_sibling_id IS NOT NULL THEN
    RETURN v_sibling_id;
  END IF;

  -- open a new halaqa cloning the source
  INSERT INTO class_offerings
    (teacher_id, program_level, capacity, status, schedule_json, session_duration_min, start_date)
  SELECT
    teacher_id, program_level, capacity, 'open', schedule_json, session_duration_min, now()::date
  FROM class_offerings
  WHERE id = p_source_offering_id
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION open_overflow_halaqa(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION open_overflow_halaqa(uuid) TO service_role;
```

---

## 4. Entity Relationship Summary

```
profiles ──< subscription_teacher_assignments >── profiles (teacher)
                │
                ├── subscription_id → subscriptions (spec 018/019)
                │
                └── approved_by → profiles (admin)

subscription_teacher_assignments.teacher_id
    ↓ (server-side check before booking INSERT)
bookings.teacher_id

class_offerings ──< open_overflow_halaqa() ──> new class_offerings (clone)
        │
        └──< session_participants (cohort membership)
```

---

## 5. Scale Audit

| Table | Est. rows at 50k | Index strategy |
|-------|-----------------|----------------|
| `subscription_teacher_assignments` | ~50k | Partial unique on `(student_id) WHERE is_active`; idx on `teacher_id WHERE is_active` |
| `bookings` (new monthly adds) | ~400k/year | Existing indexes; `(student_id, scheduled_at)` lookup |
| `class_offerings` | ~500 active | Full scan fine; add idx on `(teacher_id, program_level, status)` for sibling search |
| `session_participants` | ~50k/month | Existing indexes |
