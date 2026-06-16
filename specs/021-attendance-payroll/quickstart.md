# Quickstart: Attendance, Excuses & Teacher Payroll (Spec 021)

**5 test scenarios — use these to validate independently before integration.**

---

## Scenario 1 — Unexcused Absence (Credit Lost)

**Setup**: Active subscription student with a confirmed booking. No excuse submitted.

```bash
# 1. POST /api/attendance/record (as admin/service_role)
{
  "bookingId": "<confirmed_booking_id>",
  "outcome": "student_absent"
}
# Expected: 200 { success: true, data: { attendanceRecordId: "..." } }

# 2. Verify attendance_records row
SELECT outcome, credit_action FROM attendance_records WHERE booking_id = '<confirmed_booking_id>';
-- outcome = 'student_absent', credit_action = 'none' (credit NOT restored)

# 3. Verify student_packages balance UNCHANGED (still consumed)
SELECT sessions_remaining FROM student_packages WHERE id = '<student_package_id>';
-- same value as after booking debit — no restoration

# 4. Verify subscription_extensions NOT created
SELECT COUNT(*) FROM subscription_extensions WHERE session_id = '<session_id>';
-- 0
```

**Pass condition**: credit_action = 'none', no `subscription_extensions` row, `sessions_remaining` unchanged from post-debit value.

---

## Scenario 2 — Excused Carry-over (Credit Restored, Extension Granted)

**Setup**: Same student/booking. Excuse submitted ≥2h before session start.

```bash
# 1. POST /api/excuses/submit (as student)
{
  "bookingId": "<confirmed_booking_id>",
  "reason": "Medical appointment"
}
# Expected: 201 { isEligible: true, status: 'pending' }

# 2. PATCH /api/excuses/<excuse_id>/decide (as assigned teacher)
{ "decision": "accepted" }
# Expected: 200 { carryOverTriggered: true }

# 3. Verify attendance_records
SELECT outcome, credit_action FROM attendance_records WHERE booking_id = '<confirmed_booking_id>';
-- outcome = 'excused_carried', credit_action = 'restored'

# 4. Verify sessions_remaining RESTORED
SELECT sessions_remaining FROM student_packages WHERE id = '<student_package_id>';
-- +1 vs post-debit (credit returned)

# 5. Verify subscription_extensions row created
SELECT extension_seconds FROM subscription_extensions WHERE session_id = '<session_id>';
-- > 0 (equivalent to session duration)

# 6. Retry finalize_attendance for same booking
POST /api/attendance/record { bookingId: "...", outcome: "excused_carried" }
# Expected: 200 (idempotent no-op, returns existing attendanceRecordId) — no second restore

SELECT sessions_remaining FROM student_packages ...;
-- same value — no double-restore
```

**Pass condition**: credit_action = 'restored' exactly once, one `subscription_extensions` row, retry produces no second restore.

---

## Scenario 3 — Late Excuse (Ineligible, No Carry-over)

**Setup**: Same student/booking. Excuse submitted <2h before session start.

```bash
# 1. POST /api/excuses/submit (as student, submitted inside threshold)
{ "bookingId": "<booking_id>", "reason": "Forgot" }
# Expected: 201 { isEligible: false, status: 'ineligible' }

# 2. Attempt to decide (teacher)
PATCH /api/excuses/<id>/decide { "decision": "accepted" }
# Expected: 422 — excuse is ineligible, cannot be accepted

# 3. Record student_absent outcome
POST /api/attendance/record { "bookingId": "...", "outcome": "student_absent" }
# Expected: 200

# 4. Verify credit NOT restored, no extension
SELECT credit_action FROM attendance_records WHERE booking_id = '...';
-- 'none'
SELECT COUNT(*) FROM subscription_extensions WHERE session_id = '...';
-- 0
```

**Pass condition**: ineligible excuse cannot be accepted; finalize as student_absent with no restore.

---

## Scenario 4 — Teacher Absence (Student Held Harmless)

**Setup**: Booking where the assigned teacher is absent.

```bash
# 1. POST /api/attendance/record (as admin)
{ "bookingId": "<booking_id>", "outcome": "teacher_absent" }
# Expected: 200

# 2. Verify attendance_records: outcome = teacher_absent, credit_action = 'restored'
SELECT outcome, credit_action FROM attendance_records WHERE booking_id = '...';
-- outcome = 'teacher_absent', credit_action = 'restored'

# 3. Verify student balance restored
SELECT sessions_remaining FROM student_packages WHERE id = '...';
-- +1 vs post-debit

# 4. Verify session NOT counted as student absence
SELECT COUNT(*) FROM attendance_records
WHERE student_id = '<student_id>' AND outcome = 'student_absent';
-- same count as before (teacher_absent does NOT appear in student_absent count)

# 5. Verify session_deliveries: 0 hours attributed to absent teacher
SELECT COUNT(*) FROM session_deliveries WHERE session_id = '<session_id>';
-- 0 rows (teacher was absent; no delivery recorded)
```

**Pass condition**: student credit restored, outcome = 'teacher_absent', no session_deliveries row for absent teacher.

---

## Scenario 5 — Monthly Payroll Run (Idempotent)

**Setup**: Teacher has delivered 3 × 60-minute sessions in the same month. hourly_rate_usd = 20.00.

```bash
# 1. Confirm session_deliveries rows exist
SELECT SUM(duration_minutes), MAX(hourly_rate_usd)
FROM session_deliveries
WHERE teacher_id = '<teacher_id>' AND payroll_period_month = '2026-06-01';
-- 180 minutes, 20.00

# 2. POST /api/payroll/run (as admin)
{ "month": "2026-06-01" }
# Expected: 200 { payoutsCreated: 1, month: "2026-06-01" }

# 3. Verify teacher_payouts row
SELECT total_hours, total_amount_usd, status
FROM teacher_payouts
WHERE teacher_id = '<teacher_id>' AND payroll_period_month = '2026-06-01';
-- total_hours = 3.00, total_amount_usd = 60.00, status = 'pending'

# 4. Re-run payroll (idempotency check)
POST /api/payroll/run { "month": "2026-06-01" }
# Expected: 200 { payoutsCreated: 0 }  ← no duplicate

SELECT COUNT(*) FROM teacher_payouts
WHERE teacher_id = '<teacher_id>' AND payroll_period_month = '2026-06-01';
-- 1  (no duplicate row)
```

**Pass condition**: exactly one payout per teacher = SUM(hours) × rate; re-run creates 0 duplicates.

---

## Scenario 6 — Missing/Zero Rate Fails Loud (FR-030 / FR-029)

**Setup**: Teacher B has 1 × 60-minute delivered session in the month, but `session_deliveries.hourly_rate_usd` is `NULL` or `0` (rate not configured at delivery time). Separately, Teacher C has two delivered sessions whose snapshotted rates differ (non-uniform).

```bash
# 1. Run payroll for the month
POST /api/payroll/run { "month": "2026-06-01" }

# 2. Verify NO silent $0 payout for Teacher B
SELECT COUNT(*) FROM teacher_payouts
WHERE teacher_id = '<teacher_B_id>' AND payroll_period_month = '2026-06-01';
-- 0  (FR-030: NULL/0 rate is a config error — skipped, not paid $0)

# 3. Verify NO silent MAX-picked payout for Teacher C (non-uniform rates)
SELECT COUNT(*) FROM teacher_payouts
WHERE teacher_id = '<teacher_C_id>' AND payroll_period_month = '2026-06-01';
-- 0  (FR-029: non-uniform snapshotted rate is detected/flagged, not aggregated)

# 4. Confirm both surfaced as exceptions (RAISE WARNING in the run output,
#    or returned in the run's exceptions set for ops follow-up).
```

**Pass condition**: a teacher/month with a NULL/0 or non-uniform snapshotted rate yields **0** payout rows and is surfaced as a payroll exception — never a silent `$0` (FR-030) or silent `MAX`-picked (FR-029) payout.

**Pass condition**: Exactly one payout row created; re-run returns `payoutsCreated: 0`; total_hours = 3.00, total_amount_usd = 60.00.
