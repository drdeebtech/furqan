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

**Logic**: If `teacherId` omitted, resolves from active `subscription_teacher_assignments` for caller. Returns `teacher_availability` rows WHERE `is_booked = false AND is_active = true` for the given month.

**Response (200)**:
```typescript
{
  success: true,
  data: Array<{
    id:              string   // teacher_availability uuid
    teacherId:       string
    dayOfWeek:       number   // 0=Sun..6=Sat
    startTime:       string   // 'HH:MM'
    endTime:         string   // 'HH:MM'
    slotDurationMin: number
  }>
}
```

**Errors**:
- `401` — not authenticated
- `404` — no active assignment found (if teacherId omitted and no assignment exists)

---

## 5. POST /api/scheduling/book-slot

Books an individual session from the assigned teacher's published slot. Validates teacher constraint before creating booking.

**Auth**: Required (authenticated student)
**Method**: POST

**Zod input schema**:
```typescript
const BookSlotSchema = z.object({
  teacherAvailabilityId: z.string().uuid(),
  scheduledAt:           z.string().datetime(),  // ISO 8601
})
```

**Server-side enforcement**:
1. Resolve caller's active assignment: `teacher_id` from `subscription_teacher_assignments WHERE student_id = auth.uid() AND is_active = true`.
2. Resolve slot's `teacher_id` from `teacher_availability WHERE id = teacherAvailabilityId`.
3. If mismatch → 403.
4. `SELECT ... FOR UPDATE` on the availability row; if `is_booked = true` → 409.
5. INSERT `bookings (student_id, teacher_id, scheduled_at, status='pending')`; UPDATE `teacher_availability SET is_booked = true`.
6. Credit debit flows through existing kernel at confirmation — not here.

**Response (201)**:
```typescript
{ success: true, data: { bookingId: string } }
```

**Errors**:
- `400` — validation error
- `401` — not authenticated
- `403` — teacher does not match assigned teacher
- `404` — slot not found
- `409` — slot already booked (race condition)

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
5. If course (`product_type = 'course'`): validate `entryConfirmation` against specialist-set condition in `platform_settings` or `class_offerings.entry_conditions_json`.

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
