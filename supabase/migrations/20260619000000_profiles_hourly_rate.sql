-- T002a: Add profiles.hourly_rate_usd (spec 021 precondition).
--
-- Verified absent 2026-06-16. The finalize_attendance fn (T006) snapshots
-- this into session_deliveries.hourly_rate_usd at delivery time, so it
-- must exist before T006 and before db:types regen (T007).
--
-- CHECK >= 0 keeps the column honest while still allowing a 0 rate (which
-- run_monthly_payroll will refuse to pay — see FR-030 in the T006 fn).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hourly_rate_usd numeric(10,2) CHECK (hourly_rate_usd >= 0);
