# Research: Attendance, Excuses & Teacher Payroll (Spec 021)

**Phase**: م٤ | **Generated**: 2026-06-16 | **Spec**: `specs/021-attendance-payroll/spec.md`

---

## R-001 — subscription_extensions Table (Carry-over Without Touching Stripe Mirror)

**Decision**: New table `subscription_extensions` accumulates extension grants additively. Effective period end = `subscriptions.current_period_end + SUM(extension_seconds)` computed on read. `subscriptions.current_period_end` is never mutated.

```sql
CREATE TABLE subscription_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  session_id uuid REFERENCES sessions(id),       -- idempotency anchor per carried session
  granted_by_user_id uuid NOT NULL REFERENCES profiles(id),
  reason text NOT NULL,
  extension_seconds bigint NOT NULL CHECK (extension_seconds > 0),
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uix_subscription_extensions_session
  ON subscription_extensions(subscription_id, session_id)
  WHERE session_id IS NOT NULL;
```

> **⚠️ SUPERSEDED 2026-06-16 (Clarifications):** the idempotency anchor was changed to `booking_id`. `session_id` is nullable on `bookings` (verified against local schema), so a `session_id`-based partial unique index cannot guarantee one-grant-per-event for individual sessions. The canonical schema (`data-model.md`, tasks T003/T006/T017) now uses `booking_id NOT NULL` with `UNIQUE (subscription_id, booking_id)`; `session_id` is retained only as a nullable audit link. The rationale below still applies to the additive-table approach.

**Rationale**: Spec 018's `current_period_end` is a Stripe-mirror column protected by a BEFORE UPDATE identity guard — mutating it would corrupt the Stripe reconciliation. The additive table preserves a full per-session audit trail, is idempotent via the unique index (same `session_id` → conflict → no duplicate), and allows future revocation or inspection without touching the mirror.

**Alternatives considered**:
- Mutate `subscriptions.current_period_end` → rejected: breaks Stripe mirror, violates spec 018 guard.
- Single offset column on `subscriptions` → rejected: no per-session audit trail, not idempotent per carry-over event.

**Scale check (50k subscribers)**: One row per excused-carried session. At a generous 5% monthly absence+excuse rate → ~2,500 rows/month. Tiny. Index on `subscription_id` for the SUM query is O(log N). Acceptable.

---

## R-002 — Attendance Outcomes as a Postgres Enum

**Decision**: `CREATE TYPE attendance_outcome AS ENUM ('present', 'student_absent', 'teacher_absent', 'excused_carried')`. One `attendance_records` row per booking (UNIQUE on `booking_id`). Outcome is final once set (BEFORE UPDATE OF guard blocks re-finalization).

**Rationale**: Fixed enum enforces valid states at the DB layer — no application-level string validation needed for the outcome column. UNIQUE on `booking_id` guarantees a single, final outcome per session. A check before `finalize_attendance` is called prevents the double-accounting edge case (same booking finalized twice).

**Alternatives considered**:
- `text` with CHECK constraint → same semantics but loses Postgres enum type safety and introspectability.
- Separate tables per outcome type → over-engineering; the outcome is a simple state.

---

## R-003 — Excuse Eligibility Boundary Handling

**Decision**: Excuse is eligible if `submitted_at <= session_scheduled_at - make_interval(secs => threshold_seconds)` where `threshold_seconds` is read from `platform_settings` key `excuse_notice_threshold_seconds` (seed value `'7200'` = 2 hours). Boundary is **inclusive** — submitting at exactly the deadline is eligible. Teacher inaction at session time is **not** treated as acceptance.

```ts
// Application-layer check (settings read via getSetting())
const thresholdSeconds = parseInt(await getSetting('excuse_notice_threshold_seconds'))
const deadline = new Date(session.scheduledAt.getTime() - thresholdSeconds * 1000)
const isEligible = excuseSubmittedAt <= deadline  // inclusive
```

**Rationale**: Clear, single-expression rule that is unit-testable. Storing the threshold in `platform_settings` allows ops to change it without a deploy. Inclusive boundary matches the business requirement "at least 2 hours before." Teacher inaction defaulting to rejection is the fail-safe behavior (no automatic carry-overs without an explicit accept decision).

**Alternatives considered**:
- Exclusive boundary (`<` instead of `<=`) → rejects submission at exactly the threshold, which contradicts "at least 2 hours."
- Hardcoded 2 hours → violates FR-028 (no hardcoded policy values).

---

## R-004 — Payroll Rate Snapshot at Delivery Time

**Decision**: `session_deliveries` table captures `hourly_rate_usd` at the moment the session is recorded as delivered (snapshot from teacher's profile field). Monthly payroll aggregates `SUM(duration_minutes / 60.0 * hourly_rate_usd)` per teacher per month. `teacher_payouts` has `UNIQUE (teacher_id, payroll_period_month)` for idempotent payroll runs.

```sql
-- session_deliveries.hourly_rate_usd = teacher.hourly_rate_usd at delivery time
-- teacher_payouts unique constraint:
CREATE UNIQUE INDEX uix_teacher_payouts_period ON teacher_payouts(teacher_id, payroll_period_month);
-- Payroll run uses ON CONFLICT DO NOTHING → idempotent
```

**Rationale**: Rate-at-delivery-time is simpler and audit-friendly: the rate is captured once, immutably, at the moment the work occurred. No retroactive recomputation is needed if the rate later changes. The unique constraint on `(teacher_id, payroll_period_month)` makes the monthly run idempotent — re-running produces no duplicate payouts.

**Alternatives considered**:
- Rate at month-close → more complex (requires joining teacher profile at run time, rate changes mid-month split the calculation). Rejected.
- Storing rate only on `teacher_payouts` → loses the per-session audit trail needed if a payout is disputed. Rejected.

---

## R-005 — Reusing restore_student_package for Excused Carry-over

**Decision**: Excused carry-over path calls the **existing** `restore_student_package(p_booking_id uuid)` SECURITY DEFINER function unchanged. Idempotency is enforced by checking `attendance_records.credit_action` before calling: if already `'restored'`, skip the call.

```ts
// Inside finalize_attendance service fn (server-only, service-role client):
if (currentRecord.credit_action !== 'restored') {
  await supabaseAdmin.rpc('restore_student_package', { p_booking_id: bookingId })
  await supabaseAdmin
    .from('attendance_records')
    .update({ credit_action: 'restored', outcome: 'excused_carried', finalized_at: new Date() })
    .eq('id', currentRecord.id)
}
```

**Rationale**: The existing `restore_student_package` kernel is hardened, atomic, and security-definer locked. Re-implementing it would introduce a second code path that could diverge. The `credit_action` column on `attendance_records` is the idempotency sentinel — checking it before calling prevents double-restores even under retries. The BEFORE UPDATE OF guard on `(booking_id, student_id)` prevents a different booking from being swapped in.

**Scale check**: `restore_student_package` uses a FOR UPDATE lock on the target `student_packages` row. Under 50k monthly sessions the contention is per-booking (not global), so lock contention is negligible.

**Alternatives considered**:
- Re-implementing restore logic → rejected: duplicates hardened kernel, creates divergence risk.
- Using a DB-level unique constraint for idempotency instead of `credit_action` check → the unique constraint already exists on `attendance_records(booking_id)`; the `credit_action` check is the application-layer guard before calling the fn.
