# Contract: `markNoShow()`

**File**: `src/app/teacher/dashboard/actions.ts:289`
**Caller role**: `teacher` (own bookings) — manual mark; OR Supabase edge function `no-show-detector` (automation path)
**State transition**: `confirmed → no_show`
**`loudAction` wrap**: ✅ Already wrapped (manual path)

## Input

```ts
type MarkNoShowInput = {
  bookingId: string;             // uuid
  noShowParty: 'student' | 'teacher' | 'both';
};
```

## Output

```ts
type Result = { ok: true; message: string } | { ok: false; error: string };
```

## Side effects

1. UPDATE `bookings` SET `status='no_show'`, `no_show_party=...`. Trigger validates `confirmed → no_show` transition.
2. **Conditional**: if `noShowParty IN ('student')`: CALL `deduct_package_session(p_booking_id)`. If `IN ('teacher', 'both')`: skip deduction (FR-007, SC-004).
3. Post-commit:
   - `notify(student_id, 'session_no_show', ...)` — different template based on `no_show_party`.
   - If `no_show_party='teacher'`: also notify admin via Telegram alerting (PB-02 routing).
   - `emitEvent('session.no_show', { bookingId, noShowParty })` → n8n parent-report workflow.
   - `audit_log` insert with `severity='warning'`.

## Automation path (no-show-detector edge function)

When the edge function fires (`supabase/functions/no-show-detector/index.ts`):

1. Reads `bookings` rows where `status='confirmed'` AND `scheduled_at + duration_min < now()` AND no `sessions.started_at`.
2. Reads `session_presence_events` to determine `no_show_party`:
   - Neither party joined → `no_show_party='both'`
   - Only student joined → `no_show_party='teacher'`
   - Only teacher joined → `no_show_party='student'`
3. Applies the same SQL function path as the manual call.

## Failure modes

- Trigger rejects transition (booking already terminal): logged, no-op.
- `session_presence_events` write failure during the session window: edge function falls back to `no_show_party='both'` and admin disambiguates manually (operational fallback, edge case 7 in spec.md).
- Telegram alert failure: piped through `logError`, never throws.

## Existing instrumentation

- Wrapped via `loudAction({ name: 'teacher.mark-no-show', severity: 'warning', audit: {...}, handler: ... })`.
- Drift D-001 does NOT apply.
