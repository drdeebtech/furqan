# API Contracts: Reports, Gamification & Notifications (Spec 023)

**Phase**: م٦ | **Generated**: 2026-06-16

All routes: `userId` from `auth.getUser()`, never request input. Zod-validated inputs. Service-role for system writes.

---

## 1. `GET /api/reports/[studentId]/notes`

**Auth**: Required. Student reads own; linked guardian reads child's; teacher reads their assigned student's; admin reads all. RLS enforced at DB layer.

**Response**:
```ts
z.object({
  success: z.literal(true),
  data: z.array(z.object({
    id: z.string().uuid(),
    teacherId: z.string().uuid(),
    content: z.string(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }))
})
```

**Errors**: `401` unauthenticated; `403` not authorized for this student.

---

## 2. `POST /api/reports/[studentId]/notes`

**Auth**: Required. Teacher role only. Teacher must be assigned to this student (verified server-side).

**Input**:
```ts
z.object({
  content: z.string().min(1).max(5000),
})
```

**Response**:
```ts
z.object({ success: z.literal(true), data: z.object({ id: z.string().uuid() }) })
```

**Errors**: `401`; `403` not teacher or not assigned to student; `422` validation.

---

## 3. `GET /api/reports/[studentId]/monthly/[year]/[month]`

**Auth**: Required. Student reads own; linked guardian reads child's; admin reads all.

**Path params**: `year` integer, `month` integer 1–12.

**Response**:
```ts
z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    studentId: z.string().uuid(),
    periodYear: z.number().int(),
    periodMonth: z.number().int().min(1).max(12),
    levelAssessmentSummary: z.string().nullable(),
    generatedAt: z.string().datetime(),
  }).nullable()  // null if report not yet generated for this period
})
```

**Errors**: `401`; `403`.

---

## 4. `GET /api/certificates/[studentId]`

**Auth**: Required. Student reads own; linked guardian reads child's; admin reads all.

**Query**: `?type=appreciation_juz|appreciation_level|course_completion` (optional filter).

**Response**:
```ts
z.object({
  success: z.literal(true),
  data: z.array(z.object({
    id: z.string().uuid(),
    certificateType: z.enum(['appreciation_juz','appreciation_level','course_completion']),
    milestoneKey: z.string(),
    citedRangeStart: z.string(),  // 'surah:ayah' canonical
    citedRangeEnd: z.string(),    // 'surah:ayah' canonical
    issuedAt: z.string().datetime(),
  }))
})
```

**Errors**: `401`; `403`.

---

## 5. `GET /api/honor-board`

**Auth**: Optional (public display). Returns only `is_opted_out = false` entries.

**Query**:
```ts
z.object({
  period: z.string().optional(),  // 'YYYY-MM-DD' first day of period; defaults to current
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
```

**Response** (display-safe fields only — no email/phone/contact):
```ts
z.object({
  success: z.literal(true),
  data: z.array(z.object({
    rank: z.number().int(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    achievementMetric: z.number(),
    rankPeriod: z.string(),  // 'YYYY-MM-DD'
  }))
})
```

---

## 6. `PATCH /api/honor-board/opt-out`

**Auth**: Required. Student sets own opt-out; guardian sets for linked child.

**Input**:
```ts
z.object({
  studentId: z.string().uuid().optional(),
  // if omitted, defaults to caller's own student_id
  // if provided by guardian, validated against guardian_children
  optedOut: z.boolean(),
})
```

**Response**:
```ts
z.object({ success: z.literal(true) })
```

**Errors**: `401`; `403` not authorized for this student.

---

## 7. `POST /api/webhooks/n8n` (existing route — extend)

**Auth**: `X-N8N-Secret` header verified via `safeCompareSecret` before any side effect (fail-closed).

**Extended event-type branches** (add to existing handler):

| Event type | Action |
|------------|--------|
| `monthly_report.ready` | Generate `monthly_reports` row + INSERT `notifications`; idempotency key `report:{studentId}:{year}:{month}` |
| `certificate.earned` | INSERT `certificates` + INSERT `notifications`; idempotency key `cert:{studentId}:{type}:{milestoneKey}` |
| `payment.failed` | INSERT `notifications` (dunning/pre-suspension alert); idempotency key `notif:{recipientId}:payment.failed:{subscriptionId}-{attempt}` |
| `subscription.expiring` | INSERT `notifications` ("continue?" prompt); idempotency key `notif:{recipientId}:subscription.expiring:{subscriptionId}-{periodEnd}` |
| `absence.outcome` | INSERT `notifications` (excuse/make-up result); idempotency key `notif:{recipientId}:absence.outcome:{bookingId}-{outcome}` |

All `notif:` keys follow the canonical recipient-first schema `notif:{recipientId}:{trigger}:{subjectKey}` (FR-014: recipient, trigger, subject), where `{subjectKey}` is the per-trigger subject identifier shown above.

**Idempotency contract**: All branches check `automation_logs.idempotency_key` UNIQUE before acting. Conflict → `status='skipped'`, no side effect, return 200. Success → `status='succeeded'`. n8n failure → `status='failed'`, surface to Sentry.

**Email/WhatsApp injection guard**: any user-authored value (teacher note content, excuse reason) placed in a notification subject or header MUST have CR/LF stripped before use.

**Input shape** (all branches):
```ts
z.object({
  event: z.string(),
  payload: z.record(z.unknown()),
})
```

**Response**: `{ success: true, status: 'succeeded'|'skipped' }` — always 200 for valid signature; 401 for invalid signature.

---

## §8. Issuance vs delivery key independence (clarified 2026-06-19, CHK048)

The keys in §7 are **independent per concern** — issuance and delivery can fail and retry independently. Specifically:

| Concern | Key shape | Example |
|---------|-----------|---------|
| Artifact issuance (cert / report) | `cert:{studentId}:{type}:{milestoneKey}` / `report:{studentId}:{year}:{month}` | `cert:abc:juz:30` |
| Notification delivery | `notif:{recipientId}:{trigger}:{subjectKey}` | `notif:guardian_xyz:monthly_report.ready:report-uuid` |

**Independence contract**: a successful issuance + failed delivery (or vice versa) MUST NOT block retry of either. The two key spaces are disjoint by prefix (`cert:`/`report:` vs `notif:`); a `failed` row in one space does not lock the other. Each retries under its own key per §7 + Q1 (CHK032) delete-and-retry semantics.

The `subjectKey` for `monthly_report.ready` is the **report row id** (not the period), so two notifications for the same report (e.g. re-delivery) collapse correctly while two notifications for two distinct reports (e.g. versioned corrections per Q2) each have their own key.
