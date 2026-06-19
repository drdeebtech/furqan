# Feature Specification: Fix `is_admin()` migration-ordering failure on `supabase start`

**Feature Branch**: `refactor/follow-up-collapse` *(spec 011's work shipped via PR #458 alongside specs 015/016/017; the local bootstrap companion landed earlier in PR #456 `chore(dev): local Supabase DB bootstrap + Cursor Cloud setup docs`)*
**Created**: 2026-06-12
**Status**: **Shipped** — see `plan.md` §11 (REVISION 4) for the authoritative design and `scripts/dev-local-db-bootstrap.sh` + `supabase/migrations/20260428000000_remote_baseline.sql` for the deliverables.
**Input**: Diagnosis of `function is_admin() does not exist (SQLSTATE 42883)` on a fresh `supabase start`.

> **Note on speckit shape.** This spec is unusual: it documents infrastructure work that was diagnosed, designed, and shipped before this `spec.md` existed. The `plan.md` (4 revisions) is the authoritative design record. A `tasks.md` is not authored retroactively — the work is binary (the baseline applies cleanly or it doesn't), not a stack of独立 user stories. The INDEX marks this as Shipped once the spec regen runs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Developer boots a fresh local stack without manual intervention (Priority: P1)

A new contributor (or a returning contributor after `supabase stop -v`) runs `supabase start` followed by the local bootstrap script. The full FURQAN schema — pre-v9 baseline (`profiles`, `is_admin()`, all enums), legacy deltas (`v9…v16`), and timestamped migrations (`2026*`) — applies cleanly with no `function is_admin() does not exist` error and no manual `psql` intervention. The contributor can immediately run `npm run dev` against a faithful local replica of prod.

**Why this priority**: Without this, every fresh local setup fails on the first migration. This is the foundational developer-experience gate — nothing else works until it does.

**Independent Test**: On a machine with Docker + the Supabase CLI, run `supabase start && bash scripts/dev-local-db-bootstrap.sh`. The script must exit 0, and `psql` must confirm `select public.is_admin()` resolves at runtime (returns false for an anonymous session, true for a seeded admin).

**Acceptance Scenarios**:

1. **Given** a fresh machine with Docker running and the Supabase CLI installed, **When** the contributor runs `supabase start` then `bash scripts/dev-local-db-bootstrap.sh`, **Then** the script exits 0 and `supabase db diff --linked --schema public,private` reports only the not-yet-deployed forward objects (no baseline drift).
2. **Given** a local DB seeded by the bootstrap script, **When** a request hits an admin RLS policy under an admin JWT, **Then** `private.is_admin()` resolves `profiles` correctly at runtime (SECURITY DEFINER + `search_path` set) and the policy permits the row.
3. **Given** a prod push via `supabase db push`, **When** the CLI compares local vs remote, **Then** the baseline migration is **never executed against prod** (recorded via `migration repair --status applied`) — prod's `private.is_admin()` wrapper stays intact.

### Edge Cases

- **Out-of-band dashboard schema edits already in prod** (the CLAUDE.md §5 violation catalogued in `plan.md` §11.1) — captured in the remote-dump baseline so they're now under version control. Governance follow-up: stop making dashboard schema edits.
- **A new timestamped migration references an object the baseline doesn't have** — the failure surfaces at `supabase db reset` time during local dev, not in prod. Fix is to add the missing object to the baseline dump and re-verify `db diff --linked` is empty (baseline-only).
- **Contributor runs plain `supabase db reset` instead of the bootstrap script** — fails with `function is_admin() does not exist`. This is by design (the script applies three layers; `db reset` only applies the timestamped layer). Documented in `AGENTS.md` (Cursor Cloud specific instructions).

## Requirements *(mandatory)*

### FR-001 — Single command bootstrap
A contributor can build the full FURQAN schema on a fresh local Supabase stack by running one script after `supabase start`, with no manual `psql` or dashboard intervention.

### FR-002 — Faithful local replica
After the bootstrap script runs, the local schema matches prod HEAD exactly (modulo not-yet-deployed forward migrations). Measured by `supabase db diff --linked --schema public,private` returning only forward-object differences.

### FR-003 — No prod impact from the baseline
The baseline migration (a 314KB schema dump) is recorded as applied on remote via `supabase migration repair --status applied` so the CLI never executes it against prod. Prod's auth functions (`is_admin()`, `is_admin_or_mod()`, `is_moderator()`) — including the `public` wrappers delegating to `private` — are unchanged.

### FR-004 — Auth-function integrity
`is_admin()` semantics are preserved byte-for-byte: `role = 'admin'`, `deleted_at IS NULL`, `is_active = true`, `SECURITY DEFINER`, `STABLE`, language `sql`, with `search_path` set so runtime resolution of `profiles` works under SECURITY DEFINER.

### FR-005 — Archived history
The 102 migrations already applied on prod are preserved in `supabase/migrations_archive/` (a sibling directory the CLI does not scan). Git history is preserved via `git mv`.

## Success Criteria

- A new contributor can go from `git clone` to `npm run dev` against a working local DB in under 15 minutes, with no schema errors.
- `supabase db diff --linked --schema public,private` shows zero baseline drift on a freshly bootstrapped local stack (only forward migrations pending).
- `select public.is_admin()` returns `true` under a seeded admin JWT and `false` under an anonymous session — runtime resolution intact.
- No CI regression: `npm run sb:advisors` clean, `npm run test:unit` green.

## Key Entities

- `supabase/migrations/20260428000000_remote_baseline.sql` — schema-only dump of prod HEAD (314KB). The authoritative baseline.
- `supabase/migrations_archive/` — sibling directory holding the 102 migrations already applied on prod (preserved history, not scanned by `supabase start`).
- `scripts/dev-local-db-bootstrap.sh` — local-only bootstrap that layers `src/lib/supabase/schema.sql` (patched) + `v9…v16` legacy + `supabase/migrations/*` timestamped, with two local-only workarounds (`check_function_bodies=off`, `furqan_local_booking_end()` IMMUTABLE shim).
- `private.is_admin()`, `public.is_admin()` (wrapper), `is_admin_or_mod()`, `is_moderator()` — the auth predicates referenced by RLS policies and triggers.

## Assumptions

- The remote-dump baseline equals prod HEAD at the time of capture (2026-06-12). Future dashboard schema edits violate CLAUDE.md §5 and re-introduce drift; the governance follow-up is to stop that practice.
- The local-only workarounds in the bootstrap script (`check_function_bodies=off`, the IMMUTABLE shim) are semantically faithful and do not change runtime behavior. Documented in the script header.

## Open Questions

None. The plan went through 4 revisions and converged on REVISION 4 (remote-dump baseline + archive) as the chosen end-state. See `plan.md` §11 for the decision rationale and the rejection of the reconstruction alternative.
