# ADR-0001: `requireRole` as the auth-seam primitive; named helpers as sugar wrappers

**Status:** Accepted (2026-05-07)
**Superseded in part by:** [ADR-0003](./0003-drop-moderator-role.md) (2026-05-08) — the `requireModerator` and `requireAdminOrModerator` sugar wrappers were removed when the moderator role was dropped. The Wrap pattern still applies to `requireAdmin`.
**Context for:** Phase 5 pre-work (issue #186), Phase 5 pilot (issue #188)

## Context

FURQAN's auth seam at server-action and route-handler boundaries currently exposes three named helpers in `src/lib/auth/require-admin.ts`: `requireAdmin()`, `requireModerator()`, `requireAdminOrModerator()`. All three throw `ForbiddenError("not authenticated")` for unauthed cases and `ForbiddenError("not <role>")` for role-mismatch cases. ~24 files in `src/` import one of these.

Phase 5 (issues #186, #188) proposes extracting domain-organized server actions into `src/lib/domains/<domain>/`. Those domain actions need to gate on roles other than just "admin" / "moderator" — teacher-only actions, student-only actions, and dynamic role-list checks driven by domain logic. The three named helpers don't cover these cases, and adding `requireTeacher()` / `requireStudent()` / `requireAny([...])` doesn't scale.

A new `requireRole(role | role[])` primitive needs to land. The design question is how it relates to the three existing helpers, what its argument shape is, and how it surfaces the unauthed-vs-forbidden distinction.

## Decision

Add `requireRole` to the existing `src/lib/auth/require-admin.ts` (file rename deferred — see "Out of scope"). Four design points:

1. **Wrap pattern.** `requireRole` is the underlying primitive. The three existing named helpers (`requireAdmin`, `requireModerator`, `requireAdminOrModerator`) become one-line sugar wrappers over `requireRole(...)` — they keep their export names so the ~24 importers don't move. New code may call either form: named helpers for the common case (more readable), `requireRole` for multi-role / non-admin / dynamic-list checks.

2. **Both single + array via overload.** `requireRole(role: UserRole)` returns `{ id }`. `requireRole(roles: UserRole[])` returns `{ id, role: UserRole }` with the matched role narrowed to the input union. Single-role calls don't carry redundant role info; multi-role calls do, so downstream code knows which one matched.

3. **`UnauthenticatedError extends ForbiddenError`.** New error subclass distinguishes the two cases without magic-string `message === "not authenticated"` checks. Existing `instanceof ForbiddenError` checks at all current call sites still match (backward-compatible). The 401/403 mapping in `requireAdminForApi` and the two inline magic-string callers (`admin/notifications/actions.ts`, `admin/automation/replay/actions.ts`) can switch to `instanceof UnauthenticatedError` for the unauthed branch.

4. **Throw-based, not discriminated-union return.** Matches the existing convention. The Wrap pattern (decision 1) requires it — flipping to a `{ ok: true | false }` return shape would break ~24 importers.

## Alternatives considered

- **Replace — migrate all callers to `requireRole`.** Cleanest end state but ~24 files touched for a rename. Loses the "zero caller migration" benefit of Wrap.
- **Coexist — `requireRole` is a new helper alongside the named ones.** Two patterns drift apart over time as engineers pick whichever feels right. Rejected.
- **List-only argument shape (always `UserRole[]`).** Single-role calls get noisier (`requireRole(["admin"])`). Rejected.
- **Discriminated-union return (no throws).** TypeScript-idiomatic but breaks Wrap.
- **Single error class with `kind` field.** More verbose at construction site than `instanceof`. Rejected.
- **New file `require-role.ts` with old file as re-export shim.** Cleaner naming but adds one indirection layer for marginal benefit. The misnomer cost is small; rename if/when there's an unrelated reason to touch the file.

## Consequences

**Easier:**
- Phase 5 domain modules can call `requireRole(...)` for any role check without inventing a new helper per role.
- Auth checks at action boundaries are type-safe (no magic-string role checks; `UserRole` enum prevents typos).
- The 401-vs-403 distinction is explicit at the type level via `UnauthenticatedError`.
- Existing 24 importers don't move.

**Harder:**
- File name `require-admin.ts` becomes a slight misnomer (file now exports `requireRole`, not just admin gating). Tracked as a future cleanup; not worth a 24-file rename today.
- Future engineers may wonder why both `requireAdmin` and `requireRole` exist. This ADR is the answer.

**Out of scope (tracked separately):**
- Renaming `require-admin.ts` → `require-role.ts` — wait until there's an unrelated reason to touch all importers.
- Migrating the 24 existing `requireAdmin` etc. callers to `requireRole(...)` directly — readability of named helpers wins for the common case.
- Integrating with the `role-cache` (`src/lib/auth/role-cache.ts`) — direct DB lookup matches existing helpers; cache integration is a separate perf optimization if/when staleness becomes acceptable.
