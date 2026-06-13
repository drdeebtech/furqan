# 016 — `public_profiles` RLS-bypass lockdown (LIVE CRITICAL)

**Type:** prod security fix. **Date:** 2026-06-13. **Branch:** refactor/follow-up-collapse (PR #458).
**Lenses:** 🔒 security (primary) · 🛠 engineer (RLS / grants) · 🎓 (profile-data integrity).
**Origin:** Cursor bot HIGH on PR #458 baseline diff; **independently verified live 2026-06-13**.

## Verified exploit (live local replica = prod baseline)

`public.public_profiles` is a **postgres-owned, NON-`security_invoker`** auto-updatable view over
`public.profiles`, exposing `id, full_name, full_name_ar, avatar_url, role`. Verified state:
- `reloptions` empty → not `security_invoker` → all access runs as the **postgres owner**, which
  **bypasses `profiles` RLS** (owner is exempt).
- Grants: **`anon` and `authenticated` each hold `SELECT, INSERT, UPDATE, DELETE`** (full ALL).
- `is_updatable = YES`, `is_insertable_into = YES` → DML propagates to `profiles`.

**Impact (via Supabase REST, no auth needed):**
- `GET /rest/v1/public_profiles` as **anon** → enumerate **every** user (id, names, avatar, role) — mass PII.
- `PATCH /rest/v1/public_profiles?id=eq.<victim>` as anon → overwrite arbitrary users' `full_name`/
  `full_name_ar`/`avatar_url`/`role`.
- `DELETE /rest/v1/public_profiles?id=eq.<victim>` as anon → **delete arbitrary profile rows**.

The spec-012 P0 `roles[]` trigger does **not** stop this (view exposes scalar `role` + DELETE, not
`roles[]`; and owner-rights DML bypasses the trigger's RLS context). This is **live in prod** (baseline = dump).

## Reader analysis (so the lockdown is safe)

All **13** app references to `public_profiles` are **SELECT-only**, under authenticated `/student`,
`/teacher`, and `/lib` paths (teacher-queries, dashboard-queries, admin/name-map, messages, classes,
group-sessions). **No `anon` / `(public)`-route reader exists.** No write path uses the view.

## Fix (new forward migration — baseline is immutable)

Restore the archived control (the originating migration granted only `SELECT` to
`authenticated, service_role`, explicitly **not** `anon`):

```sql
revoke all on table public.public_profiles from anon;
revoke all on table public.public_profiles from authenticated;
grant select on table public.public_profiles to authenticated;
```

- Removes anon access entirely (no app reader needs it) and strips **all DML** (INSERT/UPDATE/DELETE)
  from both roles → kills enumeration-by-anon and arbitrary write/delete.
- Keeps **authenticated SELECT** → the 13 app readers keep working.
- `service_role` / `postgres` grants untouched (server/admin paths unaffected).
- **Do NOT** switch the view to `security_invoker` — its purpose is a controlled non-PII projection
  that intentionally lets authenticated users see other users' display names (which relationship-scoped
  `profiles_select` RLS would block); `security_invoker` would break the 13 call sites. Grant-scoping
  is the correct, minimal control.

## Acceptance / local verification (after `supabase db reset`)
1. Grants: `anon` → none; `authenticated` → `SELECT` only; `service_role` retains ALL.
2. As `anon`: `select * from public.public_profiles` → **permission denied**.
3. As `authenticated`: `select id, full_name from public.public_profiles` → **succeeds**.
4. As `authenticated`: `update/delete … public.public_profiles` → **permission denied**.
5. `npx tsc --noEmit` clean (no TS touched).
