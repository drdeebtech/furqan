# ADR-0003: Drop the moderator role from FURQAN's role taxonomy

**Status:** Accepted (2026-05-08)
**Supersedes (in part):** ADR-0001 — the `requireModerator` / `requireAdminOrModerator` sugar wrappers.

## Context

FURQAN originally specced four roles: student, teacher, admin, moderator. CONTEXT.md described moderator as "limited admin (users + CV review + session observation + audit-log read-only)." In practice, every moderator-owned feature already has an admin equivalent — `/admin/teachers/cv` mirrors `/moderator/cv-review` exactly, `/admin/audit` mirrors `/moderator/audit`, and so on.

The role added vocabulary, route surface, ENUM value, RLS branches, and 14 auth-helper call sites without giving a single capability admins didn't already have. The redundancy showed up as:

- Two duplicate route trees (`/admin/teachers/cv` vs `/moderator/cv-review`) doing the same query against `teacher_profiles where cv_status = 'pending_review'`.
- Three SQL helpers (`is_moderator`, `is_admin_or_mod`, plus a private-schema variant) that no business action depended on.
- Two TypeScript wrappers (`requireModerator`, `requireAdminOrModerator`) that callers used interchangeably with `requireAdmin`.
- One RLS policy on `resource_assignments` with `role IN ('admin', 'moderator')` that collapses cleanly to `role = 'admin'`.

Pre-flight against prod (2026-05-08, ref `xyqscjnqfeusgrhmwjts`) showed: **1** user with `role = 'moderator'` and **1** RLS policy referencing the value. The migration cost is small; the simplification yield is large (one less role to track in every gate, one less branch in every admin page).

## Decision

Three staged PRs:

1. **Data + SQL (PR-A).** Migration `20260507223609_drop_moderator_role.sql`:
   - Migrate the 1 moderator user to `'admin'` (single role + roles[] array).
   - Drop SQL helpers `is_moderator()`, `is_admin_or_mod()` (public + private schemas).
   - Rewrite the `resource_assignments_admin_all` RLS policy to admin-only.
   - **Recreate the `user_role` ENUM** without `'moderator'` (clean type swap: `rename to user_role_old` → `create new` → `alter column ... using` → `drop user_role_old`). Pragmatic alternative (CHECK constraint with the value retained) was rejected — having the value impossible at the type level was preferred over leaving a dead enum entry.
2. **Code (PR-B).**
   - Delete `src/app/moderator/` (24 tracked files).
   - Add 301 redirects in `src/proxy.ts`: `/moderator/cv-review` → `/admin/teachers/cv` (path differs), `/moderator` → `/admin` (1:1 prefix). The cv-review entry must precede the broader prefix in `RENAMED_ROUTES` because the loop matches in array order.
   - Remove `requireModerator()` and `requireAdminOrModerator()` from `src/lib/auth/require-admin.ts`. Migrate 4 call sites of `requireAdminOrModerator` to `requireAdmin` (none used the `role` field of the return type — verified at each site before sed).
   - Strip `'moderator'` from ~28 role-check arrays, type unions, compound `&&`/`||` conditions, and `Record<Role, …>` literals across the codebase.
   - Delete the 3 moderator queries from `src/lib/dashboard-queries.ts` (`getModeratorWeeklyCVActivity`, `getModeratorRatingDistribution`, `getModeratorFlaggedEvaluations`).
3. **Docs (PR-C).** This ADR. Plus an amendment to ADR-0001 (supersession note for the dropped wrappers). Plus CLAUDE.md and CONTEXT.md updates dropping moderator from the role list.

## Alternatives considered

- **Keep moderator, no-op the role.** Vocabulary tax remains. No callers gain anything. Rejected.
- **Pragmatic ENUM strategy** (CHECK constraint, leave the `'moderator'` value in the type). ~10 lines of SQL vs ~50 for the clean recreate. Rejected in favour of the clean path because the team prefers type-level guarantees over runtime checks for a forever-removal.
- **Replace moderator with finer-grained permissions** (capability-based auth: `can:cv-review`, `can:observe-session`, etc.). Larger architectural project. Rejected as out of scope for this work; FURQAN's role-based check pattern is shipping and works.
- **Keep `/moderator/*` URLs and gate them with `requireAdmin`.** Routes survive, only the role goes. Rejected — leaves a now-meaningless URL prefix as tech debt from day one. The 301 redirects preserve any pasted/cached link without keeping the dead path live.

## Consequences

**Easier:**
- Three roles, not four. Smaller mental model. RLS policies simpler.
- `requireAdmin` is the only admin gate. No "admin OR moderator" branch confusion.
- `/admin/teachers/cv` is the single CV review entry point for the platform.
- Postgres ENUM is type-safe — `'moderator'::user_role` raises an error after PR-A applies, instead of silently accepting a string that can never be inserted.

**Harder:**
- `proxy.ts` `RENAMED_ROUTES` grows by two entries (the redirects).
- Anyone with a bookmarked `/moderator/*` URL gets a 301 (intended behaviour).
- `supabase.generated.ts` will still list `'moderator'` in the `user_role` enum until regenerated post-migration. Type checking won't catch stragglers until `supabase gen types typescript --linked` runs after PR-A merges. Manual grep was the safety net during PR-B.

## Out of scope (tracked separately)

- **Capability-based auth.** Bigger architectural conversation; not blocked by this work.
- **n8n workflow audit for moderator references.** No audit was done. If any active workflow routes by `actor.role === 'moderator'`, surface separately as an ops follow-up post-cutover.
- **Audit log historical records.** `audit_log.changed_by` references user IDs whose role *was* moderator. The user IDs still exist (now with role='admin'). Historical filters by role at the time of the action lose the moderator dimension — intentional.
- **`['admin']` single-element role-check array cleanup.** PR-B left `["admin"].includes(profile.role)` in places where `profile.role === "admin"` would be cleaner. Polish for a follow-up; not part of this work.
