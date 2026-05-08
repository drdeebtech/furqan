# Research: Booking Lifecycle (دورة حياة الحجز)

**Branch**: `003-booking-lifecycle` | **Date**: 2026-05-08

> Brownfield documentation. This file captures *already-made* decisions that produced the current shipped booking implementation. It is a record, not a design exercise.

---

## Decision 1 — `validate_booking_status` is a DB trigger, not just TS pre-checks

**Choice**: Allowed booking-status transitions are enforced by a PostgreSQL trigger (`validate_booking_status`) at the DB level. Server actions in `src/app/teacher/dashboard/actions.ts` perform pre-checks for fast user feedback, but the DB trigger is the source of truth.

**Rationale**:
- Bypass paths exist outside the canonical server actions: `startInstantSession`, admin SQL ad-hoc updates, edge functions (`no-show-detector`), n8n workflows. Any of these could violate the state-machine if enforcement lived only in TS.
- Trigger enforcement is cheap (microseconds per UPDATE) and catches every code path with no per-caller wrapping.
- Aligns with Constitution Principle III: critical-path enforcement at the SQL level.

**Alternative rejected**: TS-only pre-checks. Rejected because no-show edge function and instant-session paths would need their own duplicated checks; drift between paths is the most likely failure mode.

**Trade-off**: Schema migrations to evolve allowed transitions become DB-trigger migrations, which require care across Supabase Branching. Acceptable cost.

---

## Decision 2 — No-show detection is a Supabase edge function, not a Vercel cron

**Choice**: `no-show-detector` is a Supabase edge function under `supabase/functions/no-show-detector/index.ts`, invoked on a schedule from n8n (Mac mini), not from Vercel cron.

**Rationale**:
- CLAUDE.md "Cron jobs go on n8n, not Vercel": Vercel Hobby plan caps `vercel.json` crons at one invocation/day per entry. The detector needs sub-daily granularity (every 15 minutes around peak hours).
- Edge functions sit close to the database, reducing latency for the bulk-read of confirmed bookings whose scheduled_at has passed.
- n8n on Mac mini provides retry, observability, and Telegram alerting on failure (PB-05 routing).

**Alternative rejected**: Pure SQL cron via `pg_cron`. Rejected because the detector calls `notify()` (which talks to Resend/email) and writes `automation_logs`; SQL cron has no clean way to invoke external HTTP per row.

**Scale check**: At 50k DAU with ~250k bookings/month, the detector evaluates ~8k/night confirmed bookings whose window has ended. Index on `(status, scheduled_at)` keeps this fast. ✅

---

## Decision 3 — Daily.co `createRoom` runs *before* the booking-status SQL update

**Choice**: In the confirm path, the Daily.co API call to create the room happens *before* the Postgres function flips `bookings.status` to `confirmed`.

**Rationale**:
- Constitution Principle III: external calls that must succeed before any DB write run before the SQL function. A failed external call leaves zero DB writes.
- If Daily.co is down, the booking stays `pending`. Teacher sees a loud failure (target FR-008 / Phase 2) and retries via `recreateRoom` once Daily.co recovers.
- If we flipped the row first and Daily.co failed second, we'd have a `confirmed` booking with no `room_url` — exactly the shape PB-01 documents as a recovery scenario, but artificially common.

**Alternative rejected**: Background-create the room after confirm. Rejected because students see "confirmed" state in their dashboard and click into a room that doesn't exist yet — bad UX, race-prone.

**Trade-off**: Confirm path latency is bounded by Daily.co API (~1–3s typical, up to 10s tail). SC-001 budgets 30s for the full confirm including Daily.co; this is comfortable.

---

## Decision 4 — `cancel_reason` is freeform text, not enum

**Choice**: `bookings.cancel_reason` is a freeform `text` column with no enum constraint.

**Rationale**:
- At the time of original booking-domain implementation, cancellation reasons were not yet well understood operationally. Premature enumeration would have either been incomplete (forcing schema migrations on every new reason) or generic ("other") which is no better than freeform.
- Different surfaces produce different reason strings: student-side cancel ("changed schedule"), teacher-side decline ("not available"), admin cancel ("payment dispute"), system cancel ("teacher account suspended"). Each has different downstream policy implications.

**Drift recognised**: D-002 in spec.md flags that this hurts admin reporting (no clean buckets for refund-eligibility decisions). Future remediation candidate; not in scope for this PR.

**Alternative considered for future remediation**: enum + `cancel_reason_detail` text. Allows bucketing for reports while keeping freeform context. Tracked under separate issue when prioritised.

---

## Decision 5 — Package deduction is idempotent at terminal `completed`, not at confirm

**Choice**: `deduct_package_session(uuid)` is called when a booking transitions to `completed` (typically via `endSession()`), not at confirm time. Idempotent on `(booking_id, student_package_id)`.

**Rationale**:
- A `confirmed` booking that ends `no_show` (with `no_show_party='teacher'` or `'both'`) MUST NOT deduct (FR-007, SC-004). Deducting at confirm would force a refund-back path on every no-show, which is more failure-prone than only deducting on success.
- Idempotency is enforced via the SQL function checking for an existing `payments` / `student_package_ledger` entry tied to the booking, not via TS-level guards.
- Aligns with the "atomic critical paths" principle: deduct-at-completed is one transaction; rolling back a wrongly-deducted session would be two transactions across two domains.

**Alternative rejected**: Reserve-at-confirm + commit-at-completed (two-phase). Rejected because Postgres has no native two-phase commit for this shape, and emulating it in TS introduces cross-action consistency holes.

**Open question for Phase 2**: package expires *after* confirm but *before* the session window ends. Edge case 6 in spec.md flags this. Current behaviour: the function may silently fail or deduct from an inactive package. Deferred.

---

## References

- `LIFECYCLES.md` §1 — original prose form of this state machine.
- `EXCEPTION_PLAYBOOKS.md` PB-01, PB-02, PB-06 — operational playbooks invoked when this lifecycle fails.
- `CLAUDE.md` § "Database Migrations Policy" — why migrations live where they do.
- `CLAUDE.md` § "Scale Target Rule" — why scale was sized at 50k DAU from V1.
- ADR-0004 — booking-confirm orchestrator (atomic critical path pattern).
- `supabase/functions/no-show-detector/index.ts` — automation path implementation.
