# Contract: `deduct_package_session(p_package_id uuid)` (SQL function)

**File**: `src/lib/supabase/migrations/v11_001_packages.sql:88` (definition); hardened in `supabase/migrations/20260428095637_hardening_security_definer_and_rls.sql:233`
**Caller role**: any role (function is SECURITY DEFINER, runs with function-owner privileges)
**Language**: SQL (plain, not PL/pgSQL)
**Returns**: `boolean` (`true` on success, `null` on predicate failure)
**`loudAction` wrap**: N/A — this is a SQL function, not a TS server action. Callers wrap their server-action invocation; this function itself has no TS-level return-handling.

## Signature

```sql
CREATE OR REPLACE FUNCTION public.deduct_package_session(p_package_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE student_packages
  SET sessions_used = sessions_used + 1
  WHERE id = p_package_id
    AND status = 'active'
    AND sessions_used < sessions_total
    AND (expires_at IS NULL OR expires_at > now())
  RETURNING true;
$$;
```

## Pre-conditions checked (in the predicate)

| Check | FR |
|---|---|
| Package row exists with given id | FR-002 |
| Status is `'active'` (not `'expired'` or `'cancelled'`) | FR-001 |
| `sessions_used < sessions_total` (not virtually exhausted) | FR-004 |
| `expires_at IS NULL OR expires_at > now()` (not virtually expired) | FR-005 |

## Atomicity guarantee

Predicate evaluation and counter increment happen in the same row lock. **Two concurrent calls against the same package with `sessions_remaining = 1` cannot both succeed** — Postgres serialises the row lock, the second call's predicate evaluates `sessions_used < sessions_total` as false, and the UPDATE matches zero rows.

## Return value semantics (caller MUST handle)

- `true` — deduction succeeded; counter incremented by 1.
- `null` (or `false` per JS client coercion) — predicate failed. **Caller MUST NOT proceed as if the deduction succeeded.** No row was written.

T14 in tasks.md audits whether callers handle this correctly today.

## Side effects

- **None beyond the row UPDATE.** No notify, no event, no audit log. Best-effort side effects (low-balance alert, n8n event) are post-call responsibility of the caller.
- The 2026-04-28 hardening migration tightened `search_path` and revoked unnecessary EXECUTE grants to ensure SECURITY DEFINER privilege isn't abused via search-path injection.

## Failure modes

- Package not found / not active / exhausted / expired: returns `null`. Caller surfaces "package exhausted or unavailable" error.
- Underlying UPDATE failure (e.g., DB outage): raises SQL exception. Caller's TS error handling catches it.

## Constraints (per spec.md FR-008)

- SECURITY DEFINER MUST be retained.
- `search_path = public` MUST be set (defense against schema-injection).
- Function ownership stays with `postgres` role.
