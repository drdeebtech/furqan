# ADR-0004: Use-case orchestrators in `src/lib/domains/<domain>/orchestrate.ts` — booking-confirm pilot

**Status:** Accepted (2026-05-08)
**Context for:** the cross-domain orchestration question that ADR-0002 explicitly deferred ("Whether to introduce a 'use case orchestrator' layer in `src/lib/domains/<domain>/` or stay event-driven via n8n. Tracked separately.").

## Context

After the Booking writes-only pilot (ADR-0002) shipped, an architectural review surfaced that **cross-domain choreography** — the fan-out of side effects when one domain action triggers writes in others — was scattered across **12 route adapters** doing 3+ cross-domain calls inline. The two highest-cost duplications:

- **Booking confirm** appeared at `src/app/teacher/dashboard/actions.ts:197–279` and `src/app/admin/bookings/actions.ts:43–92` with **divergent ordering** (teacher: `bookings UPDATE → createRoom → sessions INSERT → notify → emitEvent`; admin: `bookings UPDATE → emitEvent` only) and **asymmetric side effects** (admin path skipped `createRoom` and student `notify` entirely).
- **Session end** appeared at `src/app/teacher/dashboard/actions.ts:407–456` and `src/app/admin/sessions/actions.ts:71–95` with `bookings`-first vs `sessions`-first ordering and the admin path **silently dropping `emitEvent`** so n8n never learned about admin-driven session ends.

The scatter also produced a concrete user-visible bug: the previous teacher `updateBookingStatus` could leave `bookings.status='confirmed'` without a corresponding `sessions` row when the `sessions INSERT` failed after the bookings UPDATE committed (see the legacy `roomWarning = "تم تأكيد الحجز لكن فشل تسجيل الجلسة"` branch). The platform carried half-confirmed bookings indefinitely.

ADR-0002 §"Out of scope" named two candidate architectures for resolving this:
1. A "**use case orchestrator**" layer in code, sitting above domain writes.
2. **Event-driven via n8n** — domain actions only emit `booking.confirmed`, n8n workflows fan out the rest.

The choreography we want for booking-confirm is *synchronous and user-facing* (the teacher sees the confirmation succeed or fail in the same request), so the n8n-only path is unsuitable on its own. n8n continues to listen on `booking.confirmed` for downstream async work (parent emails, retention scoring, etc.) — orchestrator and n8n are complementary, not exclusive.

## Decision

Introduce **use-case orchestrators** at `src/lib/domains/<originating-domain>/orchestrate.ts`. Pilot scope: **only** the `pending → confirmed` transition (`confirmBooking`). Five design points, each crystallized through a `/improve-codebase-architecture` grilling session before any code was written:

1. **Location: inside the originating domain's folder.** `src/lib/domains/booking/orchestrate.ts`. Not a new peer `src/lib/usecases/` directory and not a domain-pair folder. Stays inside the proven Booking-pilot shape from ADR-0002. Future orchestrators (session-end, etc.) land at `src/lib/domains/<originating-domain>/orchestrate.ts` (e.g., `src/lib/domains/session/orchestrate.ts`) when their pilots ship; no empty folders shipped speculatively.

2. **Cross-domain writes: direct from the orchestrator (no `sessionDomain.create()` indirection).** The orchestrator writes to `bookings` AND `sessions` directly, accepting that the Booking orchestrator becomes coupled to the `sessions` schema. This decouples the pilot from a Session-domain extraction prerequisite — the pilot ships standalone and proves the orchestrator pattern before extending to other domains. The cost (Booking knows about `sessions` columns) is small and visible at the orchestrator's call sites.

3. **Failure semantics — atomic critical path.** The booking-confirm critical path (`bookings.status='confirmed'` UPDATE + `sessions` INSERT) is executed inside the **`confirm_booking_with_session(p_booking_id, p_room_url, p_room_name, p_expires_at)` Postgres function** (migration `20260508011953`). Pattern mirrors the existing `deduct_package_session(uuid)` (CLAUDE.md "SQL Functions"). Either both writes commit or neither does. The today-bug (confirmed-without-sessions-row) becomes unreachable.
   - **`createRoom`** (Daily.co) runs **before** the SQL function. A Daily outage produces no DB write — booking stays `pending`, no orphaned session row. Orphaned Daily rooms are cheap and self-expire.
   - **`notify(student)` and `emitEvent("booking.confirmed")`** stay **best-effort post-commit** — failures are logged via `logError` but never thrown to the caller. The booking is the source of truth; an n8n outage shouldn't roll back a successful confirmation.

4. **Failure shape: throw on every error path.** Matches ADR-0002's `createBooking` precedent. Five domain-specific error classes in `src/lib/domains/booking/types.ts`:
   - `BookingNotFoundError` — pre-read returned no row.
   - `BookingAlreadyConfirmedError` — pre-read or SQL function saw non-pending status (race-safe).
   - `BookingRoomCreationError` — Daily.co createRoom threw before any DB write.
   - `BookingConfirmError` — unexpected DB error during the atomic path.
   - (Plus the existing `BookingValidationError` / `BookingConflictError` from `createBooking`.)
   Route adapters `instanceof`-branch on each class to map to user-facing Arabic messages.

5. **Migration order — booking-confirm first.** Tightest tracer bullet (single transition, two call sites, clear duplication). Validates the orchestrator + atomic-SQL-function + best-effort-post-commit pattern before spreading. Subsequent order (deferred, NOT in this ADR's scope): `session-end` → `markNoShow` → `cancelBooking` → `gradeHomework`.

## Alternatives considered

- **Stay route-adapter-owned, just extract a shared helper function.** Lower yield — fixes drift without pulling choreography out of HTTP-land. Rejected because the locality argument (one place to read "what happens on booking confirm") was the whole point.
- **New peer folder `src/lib/usecases/`.** Cleanest layered architecture, but adds new vocabulary on top of CONTEXT.md's seven owner-domains and creates a class of files that are neither route adapters nor domain functions. Rejected — incremental over revolutionary, and the originating-domain-folder shape preserves the existing mental model.
- **Inside originating domain folder, calling a typed Session domain (`bookingDomain.confirm` calls `sessionDomain.create`).** Cleanest seams. Rejected because it implicitly required a Session domain extraction (a separate architectural conversation) before this pilot could ship. Pinned as a follow-up if/when Session is extracted.
- **Best-effort failure on critical path** (today's behavior, just centralized). Fixes order drift but leaves the half-confirmed-booking bug intact. Rejected — atomicity buys more than ordering.
- **Saga with compensating actions** (rollback bookings if sessions INSERT fails). Heaviest. Rejected for the pilot because Postgres transactions already give atomicity for the `bookings` + `sessions` pair, and the side-effects (notify, emit) are best-effort by design — no compensation needed.
- **Wrap booking-confirm + cancel + markNoShow + session-end in a single multi-orchestrator pilot.** Larger blast radius and bisect pain. Rejected in favour of "tightest tracer bullet" (booking-confirm only).
- **Move `auto-cancel-of-overlapping-pending-bookings` (teacher-side) into the orchestrator.** Rejected — that logic is a teacher-side cleanup driven by the route adapter context (admin path intentionally doesn't run it). Stays at the route adapter. Future grilling can revisit if the rule generalizes.
- **Move the teacher eval-discipline gate into the orchestrator.** Rejected — gate is a teacher-side authorization precondition (admin bypasses it intentionally). Stays at the route adapter.
- **Fix the pre-existing `emitEvent("booking.confirmed")` bug** (the teacher route emitted `booking.confirmed` unconditionally for both confirm and cancel branches because the call sat outside the if/else). Accepted as a same-PR fix — the cancel branch now emits `booking.cancelled` instead. Net behavior improvement, in-scope because the lines were being touched.

## Consequences

**Easier:**
- One file owns the answer to "what happens when a booking is confirmed?" Today the answer was scattered across two route adapters with subtle drift.
- The booking-confirm choreography is testable without spinning up Playwright. `src/lib/domains/booking/orchestrate.test.ts` covers 13 scenarios (happy path, 4 failure paths, 2 race conditions, 2 best-effort failures, plus argument-shape assertions on the SQL function and `emitEvent`/`notify` calls) using only `vi.mock(...)`.
- Admin and teacher routes now share the same canonical confirm sequence — admin's previous "skips createRoom + skips student notify + skips emitEvent" asymmetry disappears automatically because both routes call the same orchestrator.
- The `bookings`-confirmed-without-`sessions`-row bug becomes structurally impossible (transaction atomicity).
- `teacher/dashboard/actions.ts` `updateBookingStatus` shrinks meaningfully (the inline createRoom + sessions INSERT + notify + emitEvent block — ~80 lines — collapses to a single orchestrator call + error-mapping switch).
- Sets a low-bar template (`orchestrate.ts` + `confirm_booking_with_session()` SQL function pattern) for the next orchestrator (session-end, etc.) without a new design conversation.

**Harder:**
- The Booking orchestrator is coupled to the `sessions` schema. A future column rename in `sessions` requires updating both the SQL function and the orchestrator (or just the SQL function, depending on shape). Acceptable cost for not blocking on Session-domain extraction.
- A Postgres function now lives in the booking-confirm path. Future engineers need to know that the `bookings` UPDATE for the `pending → confirmed` transition no longer happens via the standard Supabase client — they must read `confirm_booking_with_session()` to understand the write.
- Two writes pre-orchestrator (`bookings` UPDATE + `sessions` INSERT, both via Supabase client) became one RPC call. Migration tooling (`supabase db push`) must apply the SQL function before the code that calls it ships. Sequencing is enforced at deploy time by merging the SQL migration before the route-adapter code lands on `main` — but since this lands as a single PR, the Supabase Migrate workflow runs first on `main`, then Vercel builds the code. Brief window where main has the code but Supabase hasn't applied yet — same window as every other migration-coupled feature; covered by the orchestrator's `BookingConfirmError` mapping if the function is missing.

## Out of scope (tracked separately)

- **Other choreographies (`session-end`, `markNoShow`, `cancelBooking`, `gradeHomework`).** Same orchestrator pattern, same Postgres-function-for-atomicity recipe. Defer until this pilot proves out.
- **Session domain extraction (the equivalent of ADR-0002 for Session writes).** When that pilot lands, the Booking orchestrator's direct `sessions` writes can be replaced with `sessionDomain.create()` calls. Not a prerequisite for this ADR.
- **Communication domain unification (channel-aware `notify()` merging `parent.ts` + n8n bypass + sentry-watch bypass).** Independent track, surfaced by the same architectural review.
- **`CONTEXT.md` taxonomy update for V17 domains** (Course / Curriculum / Quiz / Forum). Independent docs PR.
- **Promoting `notifyNewBooking()` (admin WhatsApp) into the orchestrator.** Today's `confirmBooking` doesn't call it because the admin-broadcast was historically tied to *new* booking creation, not confirmation. If product wants admin-broadcast on confirms, that's a separate decision.
- **Saga / compensation patterns.** If a future orchestrator needs to coordinate writes that can't share a Postgres transaction (e.g., across `bookings` + a Stripe charge), this ADR's atomic-SQL-function pattern doesn't apply. Reopen the conversation then.
