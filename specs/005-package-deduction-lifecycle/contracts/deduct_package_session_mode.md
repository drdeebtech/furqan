# Contract: `deduct_package_session_mode(p_package_id uuid, p_mode text)` (SQL function)

**File**: `supabase/migrations/20260505211356_extend_packages_with_session_modes.sql:77`
**Caller role**: any role (SECURITY DEFINER)
**Language**: PL/pgSQL (companion to the plain-SQL `deduct_package_session()`)
**Returns**: `boolean`
**`loudAction` wrap**: N/A (SQL function)

## Signature

```sql
CREATE OR REPLACE FUNCTION public.deduct_package_session_mode(
  p_package_id uuid,
  p_mode       text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Step 1: try to deduct from per-mode counter
  UPDATE student_packages
  SET mode_counts = jsonb_set(
        mode_counts,
        ARRAY[p_mode],
        to_jsonb((mode_counts->>p_mode)::int - 1)
      )
  WHERE id = p_package_id
    AND status = 'active'
    AND (mode_counts->>p_mode)::int > 0
    AND (expires_at IS NULL OR expires_at > now());

  IF FOUND THEN
    RETURN true;
  END IF;

  -- Step 2: fall back to legacy session_count (implicit private budget)
  RETURN deduct_package_session(p_package_id);
END;
$$;
```

## Behavior contract

1. **Per-mode hit (FR-003 happy path)**: if `mode_counts->>p_mode > 0`, decrement that JSONB key by 1. Predicate-and-increment in same row lock — atomic.
2. **Fallback (Decision 3 / D-004)**: if the per-mode counter is 0, the function falls back to calling `deduct_package_session(p_package_id)` which decrements the legacy `session_count` budget. The caller cannot distinguish per-mode hit from fallback hit from the return value alone — both return `true`. spec.md edge case 4 documents the UX surprise this can cause.
3. **No budget anywhere (terminal)**: if both per-mode is 0 AND `sessions_used >= sessions_total`, both UPDATEs miss; function returns `false`/`null`.

## Pre-conditions checked

Same as `deduct_package_session()` for the fallback branch (status, expiry). Per-mode branch additionally checks `mode_counts->>p_mode > 0`.

## Side effects

- DB row UPDATE on `student_packages.mode_counts` OR `sessions_used`.
- No notify / event / audit. Caller responsibility.

## Atomicity guarantee

Both branches use single-row UPDATEs with predicate-locked row. No race condition possible. **However**, the *combined* function is not a single transaction across step 1 + step 2 — there is a brief window between the two UPDATEs where another concurrent call could observe an intermediate state. **In practice this is harmless** because both UPDATEs operate on the same row and Postgres serialises them, but a paranoid caller could `BEGIN`/`COMMIT` around the call.

## Failure modes

- Per-mode key doesn't exist in jsonb (`mode_counts->>p_mode` is NULL): the cast to `::int` fails. Caller sees a SQL exception. **Verify**: does the function handle missing keys gracefully? If not, file as a Phase 2 polish item.
- Status not active / expired: per-mode UPDATE matches zero rows; falls back; fallback also fails; returns false.
- Underlying UPDATE error: caller catches SQL exception.

## Constraints (per spec.md FR-008)

- SECURITY DEFINER retained.
- Fallback to `deduct_package_session(p_package_id)` must remain in place per Decision 3 / migration comment ("Legacy packages with session_count > 0 implicitly grant private via the fallback").
