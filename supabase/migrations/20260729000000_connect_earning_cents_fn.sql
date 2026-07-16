-- 20260729000000_connect_earning_cents_fn.sql
--
-- Spec 040 (Stripe Connect payouts) — Slice 2: the SQL twin of the canonical
-- per-delivery earning rule (FR-006).
--
-- FR-006 requires ONE rule, implemented once in TypeScript (deriveEarningCents,
-- src/lib/domains/connect/earnings.ts) and once in SQL, PROVEN EQUAL in tests.
-- This is the SQL side. scripts/parity-040-earning-cents.ts runs the actual
-- TypeScript function against this function over a wide grid and asserts they
-- agree cent-for-cent.
--
-- Pure expand, dormant: nothing calls this function yet — the transfer sweep
-- (Slice 3) will. Adding it now lets the parity gate run before any caller
-- exists, so the two implementations can never drift apart unnoticed.
--
--   rate_cents   = round(hourly_rate_usd * 100)              -- numeric, exact (no float)
--   amount_cents = (duration_minutes * rate_cents + 30) / 60 -- integer division
--
-- The `+ 30` is the round-half-up bias (half of 60): ties go away from zero on
-- the exact decimal value. numeric arithmetic throughout means the SQL side
-- carries NO binary floating point at all.
--
-- Validation (positive duration, positive <=2dp rate) is the CALLER's job, same
-- as on the TypeScript side — the sweep only calls this for a session_deliveries
-- row that already passed the column CHECKs (duration_minutes > 0,
-- hourly_rate_usd >= 0, numeric(10,2)). STRICT: a NULL input yields NULL, never
-- a silent 0.
--
-- Overflow: the canonical rule (deriveEarningCents) rejects any input whose
-- duration_minutes * rate_cents leaves 2^53 (its "amount_out_of_range" guard),
-- which is FAR below where the products below could exceed bigint — so the sweep
-- never passes this function a value that would overflow. Even if it somehow did,
-- bigint arithmetic RAISES on overflow (never wraps silently), so the two sides
-- can only ever agree or both fail loud — never diverge into a wrong number.

CREATE OR REPLACE FUNCTION connect_earning_cents(
  p_duration_minutes integer,
  p_hourly_rate_usd  numeric
)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT (p_duration_minutes::bigint * round(p_hourly_rate_usd * 100)::bigint + 30) / 60;
$$;

COMMENT ON FUNCTION connect_earning_cents(integer, numeric) IS
  'Spec 040 FR-006: canonical per-delivery earning in integer cents, round-half-up. SQL twin of deriveEarningCents (src/lib/domains/connect/earnings.ts), proven equal by scripts/parity-040-earning-cents.ts. Dormant until the Slice 3 sweep calls it.';

-- A SECURITY DEFINER function would need an EXECUTE lockdown; this is a plain
-- IMMUTABLE SQL function (SECURITY INVOKER, the default), so it runs with the
-- caller's own privileges and grants no privilege escalation. No REVOKE needed.
