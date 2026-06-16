# API Contracts: Scheduling, Fixed-Teacher Assignment & Cohorts (Spec 020)

**Generated**: 2026-06-16 | All inputs validated with Zod at route handler boundary.

---

## 1. GET /api/scheduling/my-assignment

Returns the caller's current active teacher assignment.

**Auth**: Required (authenticated student or guardian-managed child)
**Method**: GET

**Response (200)**:
```typescript
{
  success: true,
  data: {
    id: string             // uuid
    teacherId: string      // uuid
    teacherName: string    // from profiles join
    productType: 'hifz_individual' | 'hifz_group' | 'course'
    lockMonth: string      // 'YYYY-MM-DD' (first day of locked month)
    subscriptionId: string
    approvedBy: string | null
  } | null                 // null if no active assignment
}
```

**Errors**:
- `401` — not authenticated

---

## 2. POST /api/scheduling/assign-teacher

Creates a fixed teacher assignment for a student. Service-role or admin only.

**Auth**: Admin session or internal service-role call
**Method**: POST

**Zod input schema**:
```typescript
const AssignTeacherSchema = z.object({
  studentId:      z.string().uuid(),
  teacherId:      z.string().uuid(),
  subscriptionId: z.string().uuid(),
  productType:    z.enum(['hifz_individual', 'hifz_group', 'course']),
  lockMonth:      z.string().regex(/^\d{4}-\d{2}-01$/, 'Must be first day of month (YYYY-MM-01)'),
})
```

**Response (201)**:
```typescript
{ success: true, data: { assignmentId: string } }
```

**Errors**:
- `400` — validation error
- `401` — not authenticated
- `403` — not admin/service-role
- `409` — student already has an active assignment (`uix_sta_student_active` violation)

---

## 3. POST /api/scheduling/admin/reassign-teacher

Admin-only. Reassigns teacher mid-month with approval audit, cancels future bookings.

**Auth**: Admin session only
**Method**: POST

**Zod input schema**:
```typescript
const ReassignTeacherSchema = z.object({
  assignmentId: z.string().uuid(),
  newTeacherId: z.string().uuid(),
  reason:       z.string().min(10).max(500),
})
```

**Side effects**:
1. UPDATE `subscription_teacher_assignments`: `teacher_id = newTeacherId`, `approved_by = adminUid`, `cancelled_future_bookings_at = now()`
2. UPDATE `bookings` SET `status = 'cancelled'` WHERE `student_id = assignment.student_id AND status IN ('pending','confirmed') AND scheduled_at > now()`
3. Emit `assignment_changed` event for spec 023

**Response (200)**:
```typescript
{
  success: true,
  data: {
    assignmentId:         string
    cancelledBookings:    number   // count of bookings cancelled
    newTeacherId:         string
  }
}
```

**Errors**:
- `400` — validation error
- `401` — not authenticated
- `403` — not admin
- `404` — assignment not found

---

## 4. GET /api/scheduling/available-slots

Returns open (not yet booked) availability slots for the caller's assigned teacher.

**Auth**: Required (authenticated student)
**Method**: GET

**Query params**:
```typescript
const AvailableSlotsQuerySchema = z.object({
  teacherId: z.string().uuid().optional(), // omit to use assigned teacher
  month:     z.string().regex(/^\d{4}-\d{2}$/).optional(), // 'YYYY-MM', defaults to current
})
```

**Logic**: If `teacherId` omitted, resolves from active `subscription_teacher_assignments` for caller. Returns **dated** `teacher_availability_instances` rows (one per concrete occurrence date) WHERE `is_booked = false` for the given month, joined to the active recurring `teacher_availability` template for `start_time`/`end_time`/`slot_duration_min`. Instances must be materialized for the horizon first (T003a generation fn). The recurring template's legacy `is_booked` is **not** read here — bookability is per dated instance (data-model §2a-bis).

**Response (200)**:
```typescript
{
  success: true,
  data: Array<{
    id:              string   // teacher_availability_instances uuid (the dated, lockable/bookable slot)
    templateId:      string   // teacher_availability uuid (the recurring template this instance derives from)
    teacherId:       string
    slotDate:        string   // 'YYYY-MM-DD' — the concrete date of this occurrence
    dayOfWeek:       number   // 0=Sun..6=Sat (derived from slotDate / template)
    startTime:       string   // 'HH:MM' (from template)
    endTime:         string   // 'HH:MM' (from template)
    slotDurationMin: number
  }>
}
```

**Errors**:
- `401` — not authenticated
- `404` — no active assignment found (if teacherId omitted and no assignment exists)

---

## 5. POST /api/scheduling/book-slot

Books an individual session from a **dated instance** of the assigned teacher's published slot template. Validates teacher constraint before creating booking. The booking targets `teacher_availability_instances` (a dated occurrence), never the recurring `teacher_availability` template (data-model §2a-bis).

**Auth**: Required (authenticated student)
**Method**: POST

**Zod input schema**:
```typescript
const BookSlotSchema = z.object({
  slotInstanceId: z.string().uuid(),             // teacher_availability_instances.id (dated occurrence)
  scheduledAt:    z.string().datetime(),         // ISO 8601 (must equal the instance's slot_date + start_time)
})
```

**Server-side enforcement**:
1. Resolve caller's active assignment: `teacher_id` from `subscription_teacher_assignments WHERE student_id = auth.uid() AND is_active = true`.
2. Resolve the dated instance's `teacher_id` from `teacher_availability_instances WHERE id = slotInstanceId` (denormalized from its template).
3. If mismatch → 403.
4. `SELECT ... FOR UPDATE` on the **dated instance** row (`teacher_availability_instances WHERE id = slotInstanceId AND is_booked = false`); if already booked / no row → 409. The recurring template is never the lock target.
5. INSERT `bookings (student_id, teacher_id, scheduled_at, status='pending')`; UPDATE `teacher_availability_instances SET is_booked = true` for THAT dated instance only.
6. Credit debit flows through existing kernel at confirmation — not here.
7. Emit `booking_created` event (FR-021) via the spec-023 typed event enum after the booking row commits.

**Response (201)**:
```typescript
{ success: true, data: { bookingId: string } }
```

**Errors**:
- `400` — validation error
- `401` — not authenticated
- `403` — teacher does not match assigned teacher
- `404` — slot instance not found (no `teacher_availability_instances` row for `slotInstanceId`)
- `409` — slot instance already booked (race condition)

---

## 6. POST /api/scheduling/join-halaqa

Joins a group halaqa. Handles overflow by calling `open_overflow_halaqa()` when at capacity.

**Auth**: Required (authenticated student with active group-hifz or course subscription)
**Method**: POST

**Zod input schema**:
```typescript
const JoinHalaqaSchema = z.object({
  classOfferingId: z.string().uuid(),
  // For courses with entry conditions:
  entryConfirmation: z.string().optional(),  // specialist-set entry condition token/acknowledgement
})
```

**Logic**:
1. Verify caller has active group-hifz or course subscription (from specs 018/019).
2. Fetch `class_offerings WHERE id = classOfferingId`.
3. If `status = 'open'` and `current_enrollment < capacity`: INSERT `session_participants`, increment `current_enrollment`.
4. If at capacity: call `open_overflow_halaqa(classOfferingId)` → get target_id; INSERT `session_participants` into target_id.
5. If course (`product_type = 'course'`): validate `entryConfirmation` against the specialist-set condition in `class_offerings.entry_conditions_json` (the single authoritative source — data-model §2c / T018). Condition text is specialist-authored and read from the DB, never model-generated.

**Response (201)**:
```typescript
{
  success: true,
  data: {
    membershipId:     string   // session_participants uuid
    classOfferingId:  string   // may differ from input if overflow redirected
    overflowRedirected: boolean
  }
}
```

**Errors**:
- `400` — validation error
- `401` — not authenticated
- `403` — no eligible active subscription
- `422` — entry condition not met (courses); body includes `{ unmetCondition: string }`
- `404` — class offering not found or not open
