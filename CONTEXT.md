# FURQAN Domain Glossary

This file is the canonical glossary for FURQAN's domain language. Skills consume it to ground refactor proposals, hypotheses, and test names in the project's actual vocabulary. **Use these terms exactly. Don't drift to synonyms.**

Single-context layout — one CONTEXT.md at the repo root (per `docs/agents/domain.md`). ADRs in `docs/adr/`. Feature specs in `specs/<feature>/spec.md` (spec-kit; see CLAUDE.md "Spec-Kit Workflow"). The five-principle constitution lives at `.specify/memory/constitution.md`.

---

## Roles

The `user_role` Postgres ENUM defines three roles (per ADR-0003 — moderator was dropped 2026-05-08):

- **student** — books sessions with teachers, follows up on assigned work, tracks progress.
- **teacher** — manages availability, conducts sessions, assigns and grades follow-up, submits CV for admin review.
- **admin** — full platform management. Owns CV review, audit log, session observation, user management.

A user's *active role* is one value from this enum; a user *may* have multiple roles in their `roles[]` array (per `RoleState` in `src/lib/auth/role-cache.ts`) and switch between them. The active role is what server actions and route handlers gate on.

The TypeScript type for role values is `UserRole`, exported from `@/types/database`.

## Authentication vs Authorization

These are distinct failure modes and must not be conflated:

- **Unauthenticated** — no valid Supabase session, or the session token is malformed / expired / unverifiable. Response: redirect to `/login` (route handlers) or HTTP 401 (API). Modeled as `UnauthenticatedError` in `src/lib/auth/require-admin.ts`.
- **Forbidden** — valid session, but the active role lacks permission for the action. Response: redirect to a "no permission" view (route handlers) or HTTP 403 (API). Modeled as `ForbiddenError` (parent class of `UnauthenticatedError`).

Server actions and API handlers should distinguish the two at the response layer. The `requireRole(...)` helper throws the right error class so callers don't need to inspect message strings.

## Role-gating primitives

The canonical role check at action / route boundaries:

- **`requireRole(role)`** — single-role check. Returns `{ id }`. Throws `UnauthenticatedError` if no session, `ForbiddenError` if role mismatch.
- **`requireRole([role1, role2, ...])`** — any-of role check. Returns `{ id, role }` with the matched role narrowed to the input union.
- **Sugar wrapper** — `requireAdmin()` is a one-line wrapper over `requireRole("admin")`. It exists for readability at common call sites; new code may use either form. (`requireModerator` and `requireAdminOrModerator` were removed per ADR-0003 when the moderator role was dropped.)

All four primitives live in `src/lib/auth/require-admin.ts` (the file name is a slight misnomer post-`requireRole`; not worth a renaming-PR's blast radius — see ADR-0001).

## Domains

The seven owner-domains (from CLAUDE.md's Domain Ownership Model):

- **Booking** — `bookings`, `teacher_availability`, `availability_exceptions`. Owns: createBooking, updateBookingStatus, cancelBooking.
- **Session** — `sessions`, `session_observers`. Owns: endSession, markNoShow, savePostSessionNotes.
- **Follow-up** — `homework_assignments`. Owns: createHomework, markStudentReady, gradeHomework. (Note: user-facing language is "follow-up" / "متابعة"; never "homework" / "واجب" — the DB column name is internal.)
- **Progress** — `student_progress`, `recitation_errors`, `session_evaluations`. Owns: createEvaluation, createTeacherEvaluation.
- **Package** — `packages`, `student_packages`, `payments`, `invoices`. Owns: `deduct_package_session()` SQL function, Stripe webhook fulfillment.
- **Communication** — `notifications`, `parent_reports`, `messages`, `conversations`, `message_delivery_log`, `communication_preferences`. Owns: `notify(opts)` (in-app dispatcher).
- **Automation** — `automation_logs`, `automation_dead_letter`, `platform_settings`, `retention_signals`. Owns: `emitEvent(eventName: FurqanEvent, ...)`, n8n webhook callback.

A *domain action* = a server-side function that mutates a domain's source-of-truth table(s) and emits the canonical events for that domain. Domain actions today are scattered between `src/lib/actions/<domain>.ts` (cross-role) and `src/app/{role}/{feature}/actions.ts` (route-colocated). The Phase 5 pilot (issue #188) consolidates the **write surface** of one domain (Booking) into `src/lib/domains/<domain>/{actions.ts, types.ts}`. Reads stay where they are during the pilot. See ADR-0002.

A *route adapter* = the route-colocated `actions.ts` file (e.g., `src/app/student/bookings/new/actions.ts`) that owns the boundary between HTTP/FormData/auth and domain logic. Post-migration: the route adapter does `await requireRole(...)` + `formData.get(...)` parsing, then calls the domain function with structured input. The domain function knows nothing about FormData or sessions — it operates on already-authenticated structured input. Route adapters stay wrapped in `loudAction` so domain throws become the unified `{ ok, error?, message? }` response shape. Per ADR-0002 §4 (2026-05-07 update), redirect-style adapters that end with `redirect()` are NOT wrapped in `loudAction` — the domain still throws, but the adapter try/catches and either redirects on success or surfaces the error via the form's existing mechanism.

A *cross-domain choreography* = the fan-out of side effects when one domain action triggers writes in others (e.g., booking confirm → Session insert + Package deduct + notify + emitEvent). Most cross-domain choreographies still live at the **route adapter** today.

A *use-case orchestrator* = a domain-level function that owns one cross-domain choreography end-to-end. Lives at `src/lib/domains/<originating-domain>/orchestrate.ts`. Per ADR-0004, the first orchestrator is `confirmBooking` (Booking domain) — it owns the `pending → confirmed` transition's full fan-out (Daily room creation, atomic `bookings UPDATE` + `sessions INSERT` via the `confirm_booking_with_session()` Postgres function, then best-effort `notify(student)` + `emitEvent("booking.confirmed")`). Both teacher and admin route adapters delegate to it instead of inlining the sequence. The pilot is scoped to this single transition; other choreographies (session-end, cancel, no-show, etc.) follow the same shape when their pilots ship.

## Events

The canonical event taxonomy is defined by `WEBHOOK_ROUTES` in `src/lib/automation/emit.ts`. The TypeScript type `FurqanEvent` is `keyof typeof WEBHOOK_ROUTES`. Adding an event = adding a key to the map. `emitEvent(eventName: FurqanEvent, ...)` rejects typos at compile time.

Events are *fire-and-forget* — `emitEvent` never throws to the caller. n8n consumes them; failures land in `automation_logs` with `status='failed'`.
