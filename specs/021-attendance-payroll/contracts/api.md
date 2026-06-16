# API Contracts: Attendance, Excuses & Teacher Payroll (Spec 021)

**Generated**: 2026-06-16 | All inputs validated with Zod at route boundary.

---

## 1. `POST /api/attendance/record`

Record (finalize) a session attendance outcome.

**Auth**: service_role or admin session only. Called from admin dashboard or internal cron/n8n.

**Zod input**:
```ts
const RecordAttendanceInput = z.object({
  bookingId: z.string().uuid(),
  outcome: z.enum(['present', 'student_absent', 'teacher_absent', 'excused_carried']),
  actualTeacherId: z.string().uuid().optional(), // for substitute; if omitted = assigned teacher
})
```

**Success** `200`:
```ts
{ success: true, data: { attendanceRecordId: string } }
```

**Errors**:
- `401` — not admin/service_role
- `404` — booking not found
- `409` — outcome already finalized for this booking
- `422` — `excused_carried` requested but no accepted excuse exists for this booking

**Implementation notes**:
- Calls `finalize_attendance(bookingId, outcome, actualTeacherId)` via service-role client.
- `student_id` and `teacher_id` resolved from the booking row, never from request input.

---

## 2. `POST /api/excuses/submit`

Student submits an excuse for an upcoming session.

**Auth**: authenticated student (`auth.getUser()`). Student must own the booking.

**Zod input**:
```ts
const SubmitExcuseInput = z.object({
  bookingId: z.string().uuid(),
  reason: z.string().min(1).max(1000),
})
```

**Success** `201`:
```ts
{
  success: true,
  data: {
    excuseId: string,
    isEligible: boolean,  // false if submitted inside notice threshold
    status: 'pending' | 'ineligible',
  }
}
```

**Errors**:
- `401` — not authenticated
- `403` — booking does not belong to caller
- `404` — booking not found
- `409` — excuse already submitted for this booking
- `422` — session already past or outcome already finalized

**Implementation notes**:
- `student_id` from `auth.getUser()`, never from body.
- `is_eligible` computed server-side: `submitted_at <= session.scheduled_at - threshold_seconds` (read from `platform_settings.excuse_notice_threshold_seconds`).
- If `is_eligible = false`, `status` set to `'ineligible'` immediately (teacher cannot later accept an ineligible excuse).

---

## 3. `PATCH /api/excuses/[id]/decide`

Assigned teacher (or admin) accepts or rejects a pending excuse.

**Auth**: authenticated teacher where `teacher_id = auth.uid()` on the excuse, or admin.

**Zod input**:
```ts
const DecideExcuseInput = z.object({
  decision: z.enum(['accepted', 'rejected']),
})
```

**Success** `200`:
```ts
{
  success: true,
  data: {
    excuseId: string,
    status: 'accepted' | 'rejected',
    carryOverTriggered: boolean,  // true if accepted + carry-over path initiated
  }
}
```

**Errors**:
- `401` — not authenticated
- `403` — caller is not the assigned teacher or admin
- `404` — excuse not found
- `409` — excuse already decided
- `422` — excuse is `ineligible` (cannot be accepted)

**Implementation notes**:
- On `accepted`: calls `finalize_attendance(bookingId, 'excused_carried')` via service-role; inserts `subscription_extensions` for the subscription linked to this booking.
- `decided_by` = `auth.getUser().id`; `decided_at` = now().
- Emits domain event for spec 023 notification routing.

---

## 4. `GET /api/attendance/[studentId]`

Retrieve attendance records for a student.

**Auth**: student reads own (`studentId = auth.uid()`); teacher reads where they are the `teacher_id`; admin reads all. RLS enforced at DB layer.

**Query params**:
```ts
z.object({
  from: z.string().date().optional(),   // ISO date filter start
  to: z.string().date().optional(),     // ISO date filter end
  outcome: z.enum(['present','student_absent','teacher_absent','excused_carried']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
})
```

**Success** `200`:
```ts
{
  success: true,
  data: AttendanceRecord[],
  pagination: { total: number, limit: number, offset: number }
}
```

**Errors**:
- `401` — not authenticated
- `403` — caller cannot access this student's records (RLS)

---

## 5. `POST /api/payroll/run`

Run (or re-run idempotently) monthly payroll for a given closed month.

**Auth**: admin or service_role only.

**Zod input**:
```ts
const RunPayrollInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}-01$/, 'Must be first day of month YYYY-MM-01'),
})
```

**Success** `200`:
```ts
{
  success: true,
  data: {
    payoutsCreated: number,   // 0 if already ran (idempotent)
    month: string,
  }
}
```

**Errors**:
- `401` — not admin/service_role
- `422` — month is in the future (cannot run payroll for an open month)
- `422` — invalid month format

**Implementation notes**:
- Calls `run_monthly_payroll(month)` via service-role client.
- Returns `payoutsCreated = 0` on re-run (idempotent — existing rows not overwritten).

---

## 6. `GET /api/payroll/payouts`

List teacher payouts.

**Auth**: teacher reads own payouts; admin reads all. RLS enforced at DB layer.

**Query params**:
```ts
z.object({
  teacherId: z.string().uuid().optional(),  // admin only; omit for own
  month: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  status: z.enum(['pending','paid','failed']).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
})
```

**Success** `200`:
```ts
{
  success: true,
  data: TeacherPayout[],
  pagination: { total: number, limit: number, offset: number }
}
```

**Errors**:
- `401` — not authenticated
- `403` — non-admin requesting another teacher's payouts
