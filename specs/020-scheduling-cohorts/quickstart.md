# Quickstart: Scheduling, Fixed-Teacher Assignment & Cohorts (Spec 020)

**Generated**: 2026-06-16

---

## Scenario 1 — Individual Hifz Booking Flow (US1)

**Goal**: Assign teacher → teacher publishes slot → student books → verify booking references assigned teacher.

```bash
# 1. Admin creates assignment (service-role)
POST /api/scheduling/assign-teacher
{ "studentId": "<student-uuid>", "teacherId": "<teacher-uuid>",
  "subscriptionId": "<sub-uuid>", "productType": "hifz_individual", "lockMonth": "2026-07-01" }
# Expect: 201 { assignmentId }

# 2. Teacher publishes availability (existing teacher availability UI)
# teacher_availability TEMPLATE row: teacher_id=<teacher-uuid>, day_of_week=1 (Mon), start_time="16:00"
# Materialize dated instances for the horizon (T003a fn): one
# teacher_availability_instances row per Monday in range, is_booked=false

# 3. Student checks available slots
GET /api/scheduling/available-slots
# Expect: 200, array includes the dated Monday 16:00 instance (id = instance uuid, slot_date set)

# 4. Student books the dated slot instance
POST /api/scheduling/book-slot
{ "slotInstanceId": "<slot-instance-uuid>", "scheduledAt": "2026-07-07T16:00:00Z" }
# Expect: 201 { bookingId }

# 5. Verify
SELECT teacher_id FROM bookings WHERE id = '<bookingId>';
-- Must equal <teacher-uuid> (the assigned teacher)

SELECT is_booked FROM teacher_availability_instances WHERE id = '<slot-instance-uuid>';
-- Must be true (per-instance flag; the recurring template is unaffected)
```

---

## Scenario 2 — Wrong-Teacher Rejection (US1 edge case)

**Goal**: Booking attempt against a different teacher is rejected 403.

```bash
# Student has assignment to teacher-A
# Teacher-B publishes a slot

POST /api/scheduling/book-slot
{ "slotInstanceId": "<teacher-B-slot-instance-uuid>", "scheduledAt": "2026-07-07T17:00:00Z" }
# Expect: 403 { success: false, error: "Booking must be with your assigned teacher." }

# Verify: no booking row created for this student at 17:00
SELECT count(*) FROM bookings WHERE student_id = '<student-uuid>' AND scheduled_at = '2026-07-07T17:00:00Z';
-- Must be 0
```

---

## Scenario 3 — Group Halaqa Join + Overflow (US2)

**Goal**: Fill halaqa to capacity → next joiner lands in sibling/new halaqa, not waiting list.

```bash
# Seed: halaqa with capacity=4, current_enrollment=0, program_level='juz-1'

# 1. Four students join
POST /api/scheduling/join-halaqa { "classOfferingId": "<halaqa-uuid>" }  # x4
# Expect: 201 { overflowRedirected: false } for each

# 2. Verify halaqa full
SELECT current_enrollment, status FROM class_offerings WHERE id = '<halaqa-uuid>';
-- current_enrollment=4, status='full' (or 'open' with enrollment=capacity)

# 3. Fifth student joins
POST /api/scheduling/join-halaqa { "classOfferingId": "<halaqa-uuid>" }
# Expect: 201 { overflowRedirected: true, classOfferingId: "<new-or-sibling-uuid>" }

# 4. Verify: fifth student NOT in original halaqa, NOT on waiting list
SELECT count(*) FROM session_participants WHERE class_offering_id = '<halaqa-uuid>' AND student_id = '<student5-uuid>';
-- Must be 0

SELECT count(*) FROM halaqa_waiting_list WHERE student_id = '<student5-uuid>';
-- Must be 0

# 5. Verify: fifth student in new/sibling halaqa with same program_level and teacher
SELECT program_level, teacher_id FROM class_offerings WHERE id = '<new-or-sibling-uuid>';
-- Must match original halaqa
```

---

## Scenario 4 — Teacher Lock: Self-Service Rejected, Admin Approved (US4)

**Goal**: Mid-month self-service teacher change → 403; admin reassignment → 200, future bookings cancelled.

```bash
# Assignment is locked to July 2026 (lock_month = 2026-07-01)
# Student tries mid-month self-service change (no admin endpoint for students)
# Students cannot call /api/scheduling/admin/reassign-teacher

# Attempt via assign-teacher (student calling — not admin)
POST /api/scheduling/assign-teacher
{ "studentId": "<own-uuid>", "teacherId": "<new-teacher>", ... }
# Expect: 403 (not admin/service-role)

# Admin approves reassignment
POST /api/scheduling/admin/reassign-teacher
{ "assignmentId": "<assignment-uuid>", "newTeacherId": "<new-teacher-uuid>", "reason": "Teacher incompatibility reported by guardian" }
# Expect: 200 { cancelledBookings: N, newTeacherId: "<new-teacher-uuid>" }

# Verify: future bookings cancelled
SELECT count(*) FROM bookings
WHERE student_id = '<student-uuid>' AND status IN ('pending','confirmed') AND scheduled_at > now();
-- Must be 0

# Verify: assignment updated with approved_by
SELECT approved_by, teacher_id FROM subscription_teacher_assignments WHERE id = '<assignment-uuid>';
-- approved_by = <admin-uuid>, teacher_id = <new-teacher-uuid>
```

---

## Scenario 5 — Course Enrollment with Entry Conditions (US3)

**Goal**: Qualifying student enrolls (200); non-qualifying student rejected (422 with reason).

```bash
# Course has entry_conditions_json: {"requires_completed_juz": 5}

# 1. Non-qualifying student (completed 2 juz)
POST /api/scheduling/join-halaqa
{ "classOfferingId": "<course-uuid>" }
# Expect: 422 { success: false, unmetCondition: "Requires completion of at least 5 juz" }

# 2. Qualifying student (completed 6 juz, provides confirmation)
POST /api/scheduling/join-halaqa
{ "classOfferingId": "<course-uuid>", "entryConfirmation": "confirmed-6-juz" }
# Expect: 201 { membershipId, classOfferingId: "<course-uuid>", overflowRedirected: false }

# 3. Verify: qualifying student in session_participants
SELECT count(*) FROM session_participants WHERE student_id = '<qualifying-uuid>' AND class_offering_id = '<course-uuid>';
-- Must be 1
```
