# 011 — Fix `is_admin()` migration-ordering failure on `supabase start`

**Type:** Diagnosis + fix plan. **No code/migration edits performed in this task.**
**Date:** 2026-06-12
**Lenses:** 🛠 engineer (migration correctness) · 🔒 security (authorization function integrity)

> **⚠️ REVISION 2 (2026-06-12) — scope corrected after OpenCode's first local run.**
> The `is_admin()` failure is the **first symptom of a larger gap**: the entire pre-v9
> baseline schema (`profiles`, all enums, all foundational tables/triggers/functions) is
> never applied by `supabase start`. The §6 "create three helpers" fix is **superseded** by
> §9 below. Read §9 as the authoritative plan; §1–§5 remain valid as the diagnosis of the
> first error in the chain. **The decision OpenCode asked for ("what's the call?") is Option 2,
> specified in §9.**

---

## 1. Symptom

A from-scratch local `supabase start` (which applies **only** `supabase/migrations/*.sql`
in filename-timestamp order onto an empty database) fails on the **first** migration with:

```
ERROR: function is_admin() does not exist (SQLSTATE 42883)
  at supabase/migrations/20260428000001_legal_document_versions.sql
```

The remote/prod database is unaffected.

---

## 2. Evidence (grep, not assumption)

### 2.1 Where `is_admin()` is *referenced* (earliest first)

| Migration (in `supabase/migrations/`) | Line | Use |
|---|---|---|
| `20260428000001_legal_document_versions.sql` | 36, 40 | `create policy ... using (is_admin())` ← **first use** |
| `20260428095637_hardening_security_definer_and_rls.sql` | 267 | `revoke execute on function public.is_admin()` |
| `20260428102110_revoke_execute_from_public_on_secdef.sql` | 17 | `revoke ... from public` |
| `20260428110357_restore_role_check_function_grants.sql` | 35 | `grant execute ... to anon, authenticated` |
| `20260428203550_move_role_check_helpers_to_private_schema.sql` | 57 | `alter function public.is_admin() set schema private` (self-guarded — see §4) |
| `20260429051910` … `20260531234212` (many) | — | reference `private.is_admin()` |
| `20260515131637`, `20260515131638` | 20, 15 | `if is_admin() then` (trigger bodies) |

### 2.2 Where bare `public.is_admin()` is *created*

Exhaustive sweep — `grep -rniE "create (or replace )?function (public\.)?is_admin *\(\)" --include=*.sql .`:

| File | Line | What |
|---|---|---|
| `src/lib/supabase/schema.sql` | 39 | The **canonical baseline** original definition (un-versioned reference snapshot) |
| `supabase/migrations/20260430050449_restore_public_role_helper_wrappers.sql` | 15 | Re-creates `public.is_admin()` **late**, as a thin wrapper `select private.is_admin()` |

**Neither timestamped-migrations dir nor the legacy `src/lib/supabase/migrations/` (`v9_001`…`v16_002`)
creates a bare `public.is_admin()`.** `v9_001_schema.sql` defines only `is_moderator()` (line 121)
and `is_admin_or_mod()` (line 142). The bare `is_admin()` predates `v9_001` — it lived in a
**pre-v9 baseline applied to prod historically and never re-versioned into either repo migrations dir.**

### 2.3 Two-directory history (root cause context)

`supabase/config.toml` header documents the split explicitly:

- **Legacy:** `src/lib/supabase/migrations/` with `vXX_YYY_<name>.sql`, tracked in a custom
  `public.schema_migrations` table. Applied historically/manually to prod.
- **New:** `supabase/migrations/` with `<timestamp>_<name>.sql`, tracked in Supabase's
  `supabase_migrations.schema_migrations`. These are the **only** files `supabase start` applies.

---

## 3. Exact ordering violation

On a fresh local DB, the CLI applies `supabase/migrations/` from the earliest timestamp.
The earliest file is `20260428000001_legal_document_versions.sql`, and its **second statement**
(line 36) creates an RLS policy whose `USING` expression calls `is_admin()`. Postgres resolves
function references at **policy-creation time**, so the missing function aborts the migration
immediately — before any later migration (`…095637` revoke, `…203550` move, `…050449` wrapper)
ever runs.

**The reference at `20260428000001:36` precedes the only in-repo creators
(`…050449:15`, two days later) by the entire 0428–0430 window.** Nothing in the applied
migration set creates `public.is_admin()` before its first use.

---

## 4. Why prod is fine but a fresh local apply fails

- **Prod/remote:** the pre-v9 baseline (lineage captured in `src/lib/supabase/schema.sql:39`)
  created `public.is_admin()` **long before** `20260428000001` was applied. By the time the
  timestamped migrations ran, the function already existed, so every `using (is_admin())`,
  `revoke`, `grant`, and the `alter function … set schema private` resolved cleanly.
- **Fresh local:** `supabase start` never applies the pre-v9 baseline or
  `src/lib/supabase/schema.sql` (it is a reference snapshot, not in the migrations path). The
  function is absent, so the very first timestamped migration fails.
- **Note on the move migration:** `20260428203550` is **self-guarded** — it only runs
  `alter function public.is_admin() set schema private` *if* the function exists in `public`,
  else it `raise notice 'Skipped'`. So it is **not** the failure point and needs no change; the
  failure is strictly the earlier hard reference at `20260428000001`.

---

## 5. Security lens — the object we must preserve byte-for-byte

`is_admin()` is the authorization predicate behind a large share of RLS policies and two
homework triggers. The fix must **not** alter its semantics. The authoritative shapes:

**Original `public.is_admin()` (baseline, `src/lib/supabase/schema.sql:39`):**
```sql
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND deleted_at IS NULL
      AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

End-state on prod HEAD (after `…203550` move + `…050449` wrapper):
`private.is_admin()` holds the real logic; `public.is_admin()` is a wrapper
(`select private.is_admin()`, `set search_path = public, pg_temp`).

🔒 **Hard constraints for the fix:**
- Reproduce the **exact** pre-hardening definition (role = `'admin'`, `deleted_at IS NULL`,
  `is_active = true`, `SECURITY DEFINER`, `STABLE`, language `sql`). Do **not** add/broaden
  roles, drop the soft-delete/active checks, or change `SECURITY DEFINER`.
- **Verify the real definition against the linked remote before authoring** — do not trust
  `schema.sql` blindly (it is a hand-maintained snapshot and omits an explicit `search_path`).
  Dump the truth: `supabase db dump --linked` or
  `select pg_get_functiondef('private.is_admin()'::regprocedure);` and match grants
  (`anon, authenticated, service_role`) and `search_path` exactly.
- The new migration only needs to make the object **exist** so the downstream 0428–0430
  migrations replay on it identically to how they did on prod. It must reproduce the state
  *as of just before `20260428000001`*, then let history transform it (move → private, wrapper).

---

## 6. Minimal fix (preferred)

Add **one** new migration that creates the role-check helpers **before** their first use,
idempotently, then reconcile remote history so it is never re-run against prod.

### Step 1 — Confirm the canonical definition from remote
```bash
supabase db dump --linked --schema public,private -f /tmp/remote_dump.sql
# or, targeted:
psql "$REMOTE_DB_URL" -c \
  "select pg_get_functiondef(p.oid)
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.proname='is_admin' and pg_get_function_identity_arguments(p.oid)='';"
```
Record the exact body, `SECURITY DEFINER`, `STABLE`, and any `SET search_path`, plus EXECUTE grants.

### Step 2 — Author the prefix migration
Filename **earlier than** `20260428000001` so it sorts first:
`supabase/migrations/20260428000000_baseline_role_check_helpers.sql`

Contents (idempotent; `create or replace` so it is safe everywhere):
- `create or replace function public.is_admin()` with the **verified** original body.
- Likewise `public.is_moderator()` and `public.is_admin_or_mod()` (also referenced/moved by
  `…203550`; create all three so the move loop has all its inputs on a fresh DB).
- Mirror the original grants if the downstream grant migrations assume them.

Because every later migration uses `create or replace` / self-guarded `alter … set schema`,
replaying forward on a fresh DB yields the **same HEAD** as prod:
`private.is_admin()` = full logic, `public.is_admin()` = wrapper. No prod-schema divergence.

### Step 3 — Reconcile remote checksum/history (REQUIRED)
The new file will appear in `supabase migration list --linked` as *local-only*. If the CLI
ran it against prod it would `create or replace public.is_admin()` with the **full body**,
**clobbering the prod wrapper** (`select private.is_admin()`) → schema divergence. Prevent that:

```bash
supabase migration repair --status applied 20260428000000
```

This inserts the version into `supabase_migrations.schema_migrations` as already-applied so the
CLI **records but never executes** it on remote. Prod keeps its wrapper-based `is_admin()` intact.

> **Yes — `supabase migration repair` is needed.** The local-only insertion + repair is exactly
> the supported mechanism to add a back-dated migration without rewriting applied history or
> tripping checksum validation. Do **not** edit or renumber any already-applied migration file.

### Step 4 — Verify
```bash
supabase db reset            # fresh apply of supabase/migrations/* — must succeed end-to-end
supabase migration list --linked   # local & remote in sync, no checksum mismatch
# Confirm HEAD parity:
#   private.is_admin() = full logic ; public.is_admin() = wrapper select private.is_admin()
npm run sb:advisors          # security lens: no new RLS/secdef regressions
```

---

## 7. Alternatives considered (rejected)

- **Renumber/edit `20260428000001` to define `is_admin()` inline.** ✗ Rewrites an
  already-applied migration → checksum mismatch on remote; violates the hard constraint.
- **Move/rename the late wrapper `20260430050449` to the front.** ✗ It delegates to
  `private.is_admin()`, which does not exist that early; also rewrites applied history.
- **Apply the legacy `src/lib/supabase/migrations/` dir in `supabase start`.** ✗ Even then,
  no `v*` file defines bare `is_admin()` (it predates v9_001); wouldn't fix the gap and changes
  the local bootstrap contract.
- **Add the function with a *later* timestamp.** ✗ Must exist before `20260428000001` — later
  is useless.

---

## 8. Acceptance criteria

- [ ] `supabase db reset` / `supabase start` applies cleanly from scratch (no 42883).
- [ ] New migration creates the three helpers with the **verified-from-remote** definitions
      (no semantic/search_path/grant drift).
- [ ] `supabase migration repair --status applied 20260428000000` run against linked remote;
      `migration list --linked` shows no checksum mismatch and no pending run on prod.
- [ ] Prod HEAD unchanged: `public.is_admin()` remains the `private.is_admin()` wrapper.
- [ ] `npm run sb:advisors` clean; `is_admin()` enforcement unchanged at every call site
      (RLS policies + `20260515131637/131638` triggers).

---

## 9. REVISION 2 — Authoritative plan (supersedes §6)

### 9.1 Corrected diagnosis (evidence)

`supabase start` applies **only** `supabase/migrations/*.sql`. The schema actually has **three
historical layers**, and the first two are never applied locally:

| Layer | Location | Role | Applied by `supabase start`? |
|---|---|---|---|
| 1 — pre-v9 baseline | `src/lib/supabase/schema.sql` (1089 lines; 20 tables, 8 enums, 20 functions incl. `profiles`, `user_role`, `is_admin()`) | Foundation | **No** |
| 2 — legacy deltas | `src/lib/supabase/migrations/v9_001 … v16_002` (25 files) | Builds on layer 1 (e.g. `ALTER TYPE user_role ADD VALUE 'moderator'`) | **No** |
| 3 — timestamped | `supabase/migrations/2026*.sql` | Builds on layers 1+2 | **Yes** |

Grep proof:
- `create table … profiles` exists **only** at `src/lib/supabase/schema.sql:97` — **zero** hits in
  `supabase/migrations/` and **zero** in the legacy `v*` dir.
- No `2026*` migration does `CREATE TABLE` for any core baseline table
  (`profiles/bookings/sessions/teacher_profiles/payments/messages/notifications`) → **no
  collision** when the baseline is front-loaded.
- `is_admin()`'s body is `LANGUAGE sql` → Postgres validates `SELECT … FROM profiles` at
  `CREATE FUNCTION` time, so the helper cannot exist before `profiles`. Real error on the
  attempted §6 fix: `ERROR: relation "profiles" does not exist (42P01)`.

**Conclusion:** the fix is not "create three functions"; it is "make the layer-1+2 baseline part
of what `supabase start` applies, exactly once, at the front."

### 9.2 The call — **Option 2: front-load the legacy baseline as one squashed migration**

Reject the other two:
- **Option 1 (hand-expand the migration with profiles + enums piece by piece)** ✗ builds a partial,
  drift-prone mirror of `schema.sql`; every `supabase db reset` reveals the next missing object.
- **Option 3 (`LANGUAGE plpgsql` to defer body validation for the 3 helpers)** ✗ only walks the
  failure to the next missing table; not a complete fix. (May be used as a throwaway probe, not shipped.)

### 9.3 Implementation steps (for OpenCode)

**Generate the baseline deterministically — do NOT hand-write it.**

1. **Build the baseline SQL from the canonical legacy sources** (apply to a throwaway Postgres,
   then dump — this guarantees fidelity, no hand-mirroring):
   ```bash
   # scratch DB
   createdb furqan_baseline_tmp
   psql furqan_baseline_tmp -v ON_ERROR_STOP=1 -f src/lib/supabase/schema.sql
   for f in $(ls src/lib/supabase/migrations/v*.sql | sort -V); do
     psql furqan_baseline_tmp -v ON_ERROR_STOP=1 -f "$f"
   done
   pg_dump furqan_baseline_tmp --schema-only --no-owner --no-privileges \
     --schema=public --schema=private > /tmp/baseline.sql
   dropdb furqan_baseline_tmp
   ```
   *(If any `v*` file is intentionally non-idempotent / out-of-transaction — e.g. the v9
   `ALTER TYPE … ADD VALUE` — run those statements standalone as their headers instruct.)*

2. **Place it as the earliest migration** so it sorts before `20260428000001`:
   `supabase/migrations/20260428000000_baseline_legacy_schema.sql` = contents of
   `/tmp/baseline.sql`, wrapped to be safe (`create table if not exists` / guarded `do $$` blocks
   where the dump isn't already idempotent). Add a header comment pointing back to this spec and to
   `schema.sql` + `v9_001…v16_002` as the source of truth.

3. **Reconcile remote history (REQUIRED — prevents prod clobber):**
   ```bash
   supabase migration repair --status applied 20260428000000
   ```
   Prod already has every baseline object (and is past HEAD). Marking the baseline *applied without
   running* stops the CLI from executing a full-schema script against prod (which would
   `create or replace` the auth functions and overwrite prod's `private`-delegating wrappers).

4. **Verify (the hard gate):**
   ```bash
   supabase db reset                 # baseline + ALL 2026* must apply green, end-to-end
   ```
   If a later `2026*` migration fails on a still-missing object, that object was an out-of-band
   pre-cutover change — add it to the baseline and repeat until `db reset` is clean.
   ```bash
   # Prove zero drift from prod (no schema divergence):
   supabase db diff --linked         # expect: no differences
   npm run sb:advisors               # security lens: no new RLS/secdef regressions
   npm run test:unit
   ```

### 9.4 Security lens (unchanged, now broader)

The baseline is **dumped from `schema.sql`**, the canonical source for the auth functions, so
`is_admin()` / `is_admin_or_mod()` / `is_moderator()` carry their exact bodies
(`role = 'admin'`, `deleted_at IS NULL`, `is_active = true`), `SECURITY DEFINER`, `STABLE`, and
grants. The downstream `2026*` migrations then replay the move-to-`private` + public-wrapper exactly
as on prod. **`supabase db diff --linked` returning empty is the proof that no auth boundary,
search_path, or grant drifted.** Do not substitute a hand-written function body for the dump.

### 9.5 Revised acceptance criteria (supersede §8)

- [ ] `supabase db reset` applies **baseline + all 2026\*** from scratch with no error.
- [ ] Baseline migration is **generated from `schema.sql` + `v9…v16`** (committed procedure in §9.3),
      not hand-authored.
- [ ] `supabase migration repair --status applied 20260428000000` run on the linked remote;
      `supabase migration list --linked` shows it applied on both sides, no checksum mismatch,
      no pending run against prod.
- [ ] `supabase db diff --linked` reports **no differences** (prod schema unchanged; auth functions
      byte-identical).
- [ ] `npm run sb:advisors` clean; `npm run test:unit` green.

### 9.6 Open question for the human (one decision)

The baseline reconstruction assumes `schema.sql + v9…v16` equals prod's schema at the 2026-04-28
cutover. If you'd rather eliminate reconstruction risk entirely, the alternative is to **dump the
baseline straight from the linked remote at HEAD and `supabase migration squash` the whole history
into one baseline** — cleaner fidelity, but it rewrites local migration history (all `2026*` folded
in) and needs a full `migration repair` reconcile. Default recommendation: the §9.3 reconstruct-and-
verify path, because `db diff --linked` catches any drift and it keeps the existing `2026*` files
intact. Flag if you want the squash route instead.
