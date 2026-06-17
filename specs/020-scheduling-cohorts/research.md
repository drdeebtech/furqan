# Research: Scheduling, Fixed-Teacher Assignment & Cohorts (Spec 020)

**Phase**: م٣ | **Generated**: 2026-06-16 | **Spec**: `specs/020-scheduling-cohorts/spec.md`

---

## R-001 — Fixed Teacher Assignment DB Pattern

**Decision**: One new table `subscription_teacher_assignments` with a partial unique index `uix_sta_student_active ON subscription_teacher_assignments(student_id) WHERE is_active = true` to enforce one active assignment per student. All other scheduling tables (`bookings`, `teacher_availability`, `class_offerings`, `sessions`, `session_participants`) are reused unchanged.

```sql
CREATE TABLE subscription_teacher_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES profiles(id),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  product_type text NOT NULL CHECK (product_type IN ('hifz_individual','hifz_group','course')),
  lock_month date NOT NULL,       -- first day of the locked calendar month
  is_active boolean NOT NULL DEFAULT true,
  approved_by uuid REFERENCES profiles(id),  -- NULL = renewal; set = admin mid-month change
  cancelled_future_bookings_at timestamptz,  -- set after admin change resolves future bookings
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uix_sta_student_active ON subscription_teacher_assignments(student_id)
  WHERE is_active = true;
CREATE INDEX idx_sta_student ON subscription_teacher_assignments(student_id) WHERE is_active;
CREATE INDEX idx_sta_teacher ON subscription_teacher_assignments(teacher_id) WHERE is_active;
```

**Rationale**: A partial unique index on `(student_id) WHERE is_active = true` enforces the "one active assignment per student" invariant at the DB layer, handling concurrency correctly. A single table is sufficient — historical assignments (is_active = false) are retained for audit. No separate history table needed.

**Alternatives considered**:
- Trigger-based check: TOCTOU race under concurrent activation; rejected.
- Separate `assignment_history` table: unnecessary — `is_active=false` rows are the history.
- `parent_id` self-referential column: over-engineering for a simple audit chain.

**Scale check**: At 50k students, each with at most one active assignment = 50k rows in the partial index. B-tree lookup O(log N) — acceptable.

---

## R-002 — Constrained Booking Enforcement (Server-Side, Not DB Trigger)

**Decision**: Server-side check in the booking API route: before inserting into `bookings`, verify that the target `teacher_id` matches the caller's active assignment. The check reads from `subscription_teacher_assignments WHERE student_id = (select auth.uid()) AND is_active = true`. If no assignment exists or teacher doesn't match → 403. The existing booking kernel (`deduct_package_session`, `confirm_booking_with_session`) is not modified.

```typescript
// In POST /api/scheduling/book-slot route handler:
const { data: assignment } = await supabase
  .from('subscription_teacher_assignments')
  .select('teacher_id')
  .eq('student_id', user.id)  // user from auth.getUser(), never input
  .eq('is_active', true)
  .single()

if (!assignment || assignment.teacher_id !== resolvedTeacherId) {
  return NextResponse.json({ success: false, error: 'Booking must be with your assigned teacher.' }, { status: 403 })
}
```

**Rationale**: The existing booking identity guard (migration `20260613140000`) already prevents client-supplied teacher_id from binding to the wrong teacher. Adding a server-side assignment check in the route keeps the constraint readable, testable, and non-destructive to the existing kernel. A DB trigger would require modifying the booking insert path, creating risk of breaking the existing atomic debit.

**Alternatives considered**:
- DB trigger on `bookings` INSERT: touches the existing hardened kernel path; risk of subtle breakage; harder to test in isolation.
- RLS policy on `bookings`: RLS policies can't easily join across tables with complex business logic in a performant way.
- Additional column on `bookings`: would duplicate assignment data; denormalization without benefit.

**Scale check**: Single point-lookup on `subscription_teacher_assignments` by `student_id` (indexed) before each booking. O(log N) on the partial index — negligible overhead.

---

## R-003 — Overflow-Opens-New-Halaqa Pattern

**Decision**: `open_overflow_halaqa(p_source_offering_id uuid) RETURNS uuid` — a SECURITY DEFINER function that atomically:
1. Checks for an existing not-full sibling halaqa (same `program_level`/juz metadata, same `teacher_id`, status `'open'`, `current_enrollment < capacity`).
2. If found: returns its id (sibling reuse).
3. If not found: INSERTs a new `class_offerings` row cloning the source's schedule fields, returns the new id.

The route calls this function only when the target halaqa is at capacity; normal joins bypass it.

**Precondition**: migration T002a MUST add the 5 missing `class_offerings` columns (`program_level`, `schedule_json`, `session_duration_min`, `start_date`, `entry_conditions_json`) before this function is created (T005). The task order in plan.md (T002a → T003a → T004 → T005) guarantees this.

```sql
CREATE OR REPLACE FUNCTION open_overflow_halaqa(p_source_offering_id uuid)
RETURNS TABLE(halaqa_id uuid, was_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sibling_id uuid;
  v_new_id uuid;
  v_source class_offerings%ROWTYPE;
BEGIN
  SELECT * INTO v_source FROM class_offerings WHERE id = p_source_offering_id FOR SHARE;

  -- prefer existing not-full sibling
  SELECT id INTO v_sibling_id
  FROM class_offerings
  WHERE teacher_id = v_source.teacher_id
    AND program_level = v_source.program_level
    AND status = 'open'
    AND current_enrollment < capacity
    AND id <> p_source_offering_id
  ORDER BY current_enrollment DESC  -- fill least-empty sibling first (deterministic; matches data-model §3)
  LIMIT 1;

  IF v_sibling_id IS NOT NULL THEN
    RETURN QUERY SELECT v_sibling_id, false;
    RETURN;
  END IF;

  -- open a new halaqa cloning the source schedule
  INSERT INTO class_offerings (teacher_id, program_level, capacity, status, schedule_json, session_duration_min, start_date)
  SELECT teacher_id, program_level, capacity, 'open', schedule_json, session_duration_min, now()::date
  FROM class_offerings
  WHERE id = p_source_offering_id
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT v_new_id, true;
END;
$$;

REVOKE EXECUTE ON FUNCTION open_overflow_halaqa(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION open_overflow_halaqa(uuid) TO service_role;
```

**Rationale**: SECURITY DEFINER ensures the insert runs with service-role privileges regardless of the caller's RLS context. The FOR SHARE lock on the source prevents concurrent clone storms. Sibling preference satisfies the spec requirement (#34) to avoid halaqa proliferation.

**Alternatives considered**:
- Application-layer clone: race condition between concurrent overflow joiners — both read "at capacity," both clone. DB function with FOR SHARE eliminates this.
- Waitlist: explicitly rejected by spec decision #34.
- Pre-create all siblings: over-provisioning; admin overhead.

**Scale check**: Function runs only at overflow events — rare. FOR SHARE lock is brief. No scale concern.

---

## R-004 — Slot Double-Book Race Prevention

> **SUPERSEDED 2026-06-16** (Clarifications §2026-06-16): a recurring `teacher_availability` row is a weekly *template* and cannot carry a global `is_booked` flag — the same weekday slot recurs every week. The lock target below is therefore a **dated slot instance** (one materialized occurrence of the template on a specific date), not the recurring template row. `is_booked` semantics are **per dated instance** (see data-model §2a / §2a-bis). The `FOR UPDATE` serialization pattern is unchanged; only the locked row changes from the template to its dated instance.

**Decision**: Lock the dated **slot instance** row (a materialized occurrence of the recurring `teacher_availability` template on a specific date) with `SELECT ... FOR UPDATE` when checking availability before creating the booking. This serializes concurrent attempts on the same dated slot. The query pattern (target = the dated instance, not the recurring template):

```sql
-- p_slot_instance_id identifies ONE dated occurrence, not the weekly template
SELECT id, is_booked FROM teacher_availability_instances
WHERE id = p_slot_instance_id AND is_booked = false
FOR UPDATE;
-- if row found: proceed with booking INSERT + mark is_booked = true
-- if no row: dated slot already taken, reject
```

This is implemented in the booking domain function called by `POST /api/scheduling/book-slot`. The existing `confirm_booking_with_session` kernel handles the credit debit race independently (it already uses `FOR UPDATE` on `student_packages`).

**Rationale**: `FOR UPDATE` on the availability row serializes concurrent slot selections at the DB layer — exactly one transaction wins, the loser retries or is rejected. Application-level TOCTOU ("check then insert") would allow two concurrent requests both past the check. This is the minimal addition: the debit race is already handled by the kernel.

**Alternatives considered**:
- Unique constraint on bookings (teacher_id, scheduled_at): would reject the second insert, but the first booking would already have partially advanced (e.g., a pending debit). FOR UPDATE is cleaner.
- Optimistic locking with a `version` column: more complex; overkill for slot booking.

**Scale check**: Row-level lock on a single `teacher_availability` row. Lock duration = one booking transaction (~10ms). No fan-out. Negligible at 50k users.

---

## R-005 — Admin Mid-Month Teacher Change Resolution

**Decision**: Admin reassignment flow:
1. Admin calls `POST /api/scheduling/admin/reassign-teacher` with `{assignmentId, newTeacherId, reason}`.
2. Server (admin session) UPDATEs `subscription_teacher_assignments`: `teacher_id = newTeacherId`, `approved_by = adminUser.id`, `cancelled_future_bookings_at = now()`.
3. Server cancels all future bookings: `UPDATE bookings SET status = 'cancelled' WHERE student_id = :studentId AND status IN ('pending','confirmed') AND scheduled_at > now()`.
4. Server emits an `assignment_changed` event (e.g., inserts into an `events` or `notifications_queue` table for spec 023 to consume).
5. Student sees new assigned teacher and rebooks from their published availability.

BEFORE UPDATE OF guard on `(student_id, subscription_id, product_type, lock_month)` prevents any client from altering identity columns. The `approved_by` and `teacher_id` columns are allowed UPDATE for service_role/admin paths only.

**Rationale**: Cancel-and-rebook is simpler and safer than re-pointing bookings to the new teacher's slots — the new teacher may have different availability, and silently re-pointing would create bookings at times the new teacher has not offered. The audit trail (`approved_by`, `cancelled_future_bookings_at`) satisfies FR-004.

**Alternatives considered**:
- Re-point existing bookings to new teacher: mismatches new teacher's published slots; risk of booking times the teacher hasn't accepted.
- Deferred cancellation at session time: students would have stale bookings; confusing UX.
- Soft-delete + new assignment: same outcome, more tables. UPDATE + history via `is_active` flag chain is sufficient.

**Scale check**: A single student has at most ~8-10 future bookings in a month. Bulk cancel is trivial.
