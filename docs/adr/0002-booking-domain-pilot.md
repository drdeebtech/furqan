# ADR-0002: Booking domain pilot — writes-only extraction into `src/lib/domains/booking/`

**Status:** Accepted (2026-05-07)
**Context for:** Phase 5 pilot (issue #188). Builds on ADR-0001 (`requireRole` auth seam, shipped in PR #199).

## Context

FURQAN's seven owner-domains are documented in CONTEXT.md (Booking / Session / Follow-up / Progress / Package / Communication / Automation). Today, a domain's *write surface* is split between:

- `src/lib/actions/<domain>.ts` — extracted when called by multiple roles (Follow-up, Progress, Communication, etc.)
- `src/app/{role}/{feature}/actions.ts` — route-colocated server actions per Next.js App Router default

The split is **convention-driven, not enforced**. Two engineers writing the same booking-side mutation might pick different homes. Cross-domain choreography (booking confirm → Session insert + Package deduct + notify + emitEvent) lives entirely at route-colocated call sites today, scattered across `src/app/teacher/dashboard/actions.ts`, `src/app/admin/bookings/actions.ts`, etc.

Phase 5 of the architectural deepening roadmap (`~/.claude/plans/eager-beaming-bubble.md`) proposed extracting domain-organized actions into `src/lib/domains/<domain>/`. Issue #188 picks Booking as the pilot — highest read traffic (61 files), most-distributed write surface (5–7 sites across student/admin/teacher/cron paths), heaviest cross-domain fan-out.

## Decision

Extract the **Booking domain's write surface** into `src/lib/domains/booking/{actions.ts, types.ts}`. Five design points crystallized during the `/grill-with-docs` session:

1. **Scope: writes-only.** The 5–7 booking write sites move into the domain module. The 61 booking-read files stay where they are during the pilot. Cross-domain choreography (Session insert, Package deduct, notify, emitEvent) stays at the **route adapter** for now — orchestration is a separate later conversation. Smallest cohesive unit; ships in 1–2 PRs; clearly demonstrates the pattern.

2. **Folder shape: two files (`actions.ts` + `types.ts`).** Drop the original plan's proposed `events.ts` and `queries.ts`:
   - `events.ts` would wrap each `emitEvent("booking.X", ...)` in a typed helper. Not worth the indirection — events are already typed at source via `FurqanEvent` (per Phase 2 / PR #174).
   - `queries.ts` is empty under the writes-only scope.
   - One-file-per-action shape rejected — for 5–7 actions per domain × 7 domains, the file count balloons.

3. **Route-adapter shape: route owns auth + FormData; domain takes structured input.** The route-colocated `actions.ts` files become thin adapters:
   ```ts
   "use server";
   export const createBooking = loudAction({
     name: "student.create-booking",
     handler: async (formData: FormData) => {
       const { id: studentId } = await requireRole("student");
       const input = {
         studentId,
         teacherId: formData.get("teacher_id") as string,
         scheduledAt: formData.get("scheduled_at") as string,
         // ... structured parsing
       };
       return await bookingDomain.createBooking(input);
     },
   });
   ```
   Domain function knows nothing about FormData or sessions. Testable without HTTP/auth mocking.

4. **Failure shape: throw on failure, return data on success.** Domain functions are internal-only. They throw on failure (using domain-specific Error subclasses or plain `Error`); return data on success. Route adapter is wrapped in `loudAction` (per the existing #161/#164–#169 sweep), which catches the throw and returns the unified `{ ok, error?, message? }` shape. Conflicts with `loudAction`'s contract are avoided; lines up with the `requireRole` pattern (throws `ForbiddenError`; loudAction handles it). Minimum boilerplate, same convention everywhere.

5. **Migration order: createBooking first.** Cleanest tracer bullet — single-table insert, minimal cross-domain entanglement (just emits `booking.created`). Validates the pattern before tackling the harder paths. Subsequent order: markNoShow (medium complexity, 2–3 cross-domain calls) → updateBookingStatus (heaviest, full Session+Package+notify+emit fan-out) → cancelBooking → admin bulk-actions.

## Alternatives considered

- **Writes + cross-domain orchestration (full confirm flow into the domain).** More ambitious; moves the question of "where do orchestrators sit?" into the pilot's scope. Rejected — broader architectural call deserves its own grilling session after the writes-only pilot proves the pattern.
- **Writes + reads + queries.ts.** Tedious mechanical migration of 61 read sites; doesn't move the architectural needle proportionally. Rejected.
- **Three files including `events.ts`.** Rejected — events are already typed at source.
- **One file per action (feature-folder shape).** Rejected — file-count tax across 7 domains.
- **Pass-through route adapter (one-liner).** Rejected — couples domain to Next.js conventions, defeats testability gain.
- **Discriminated-union return / Supabase-style return.** Rejected — conflicts with `loudAction`'s throw-catch contract.
- **Replace, not Wrap (delete route-colocated actions entirely, force consumers to import from `@/lib/domains/booking`).** Rejected for this pilot — Next.js still wants `"use server"` at the route boundary; route adapters stay as the HTTP-facing layer. Wrap pattern matches ADR-0001's approach for `requireRole`.

## Consequences

**Easier:**
- Booking domain logic is testable without HTTP/FormData/auth mocking — the domain function takes structured input and returns data (or throws).
- "Where does this booking write live?" answered by reading one folder.
- Future `requireRole(["teacher", "admin"])`-style cross-role gating becomes natural at the route adapter layer, with the actual write delegated to a single domain function.
- Sets a low-bar template (two files) other domains can follow without a long design conversation.
- Existing `loudAction` plumbing (audit_log, Sentry breadcrumb, Telegram on critical) keeps working unchanged.

**Harder:**
- Booking writes now span two files (route adapter + domain). Adding a new write means touching both.
- Departure from Next.js's route-colocated convention. Engineers expecting all booking actions in `src/app/{role}/bookings/` will be confused at first; the file path no longer tells the whole story. CONTEXT.md's "domain action" + "route adapter" entries are the disambiguation.
- Cross-domain orchestration stays scattered across route adapters during the pilot. If the writes-only pattern doesn't generalize, the orchestration layer becomes the next architectural conversation.

## Out of scope (tracked separately)

- **Cross-domain orchestration layer.** Whether to introduce a `useCases/` directory or stay event-driven via n8n is a future grilling target.
- **Booking reads (queries.ts).** 61 files; mechanical migration; can ride per-feature dashboard refactors as they happen.
- **Other domains (Session, Follow-up, Progress, Package, Communication, Automation).** Wait for the Booking pilot to ship + prove + reveal sharp edges before extending.
- **Renaming or merging the existing `src/lib/actions/<domain>.ts` files** (e.g., `homework.ts`, `evaluations.ts`) into the new `src/lib/domains/<domain>/` shape. Defer until the pilot's pattern is proven; bulk-rename later.
- **Test harness for domain functions.** Per ADR-0001 / PR #199 precedent, pure-function pieces of the domain (validation, mappers) get colocated `*.test.ts` files. Heavy I/O paths (the Supabase writes themselves) need an integration test seam that doesn't exist in the current test setup; defer.
