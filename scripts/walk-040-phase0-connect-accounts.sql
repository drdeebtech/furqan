-- Rolled-back verification walk for
-- 20260731000000_connect_accounts_and_payout_method.sql
-- (spec 040 Phase 0 — FR-003 / FR-025 / FR-021 / FR-017). Run:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/walk-040-phase0-connect-accounts.sql
-- Every assertion RAISEs on failure; the whole walk rolls back (BEGIN…ROLLBACK).
--
-- Named scripts/walk-040-phase0-connect-accounts.sql to sit beside its siblings
-- (scripts/walk-040-earnings-ledger.sql, scripts/walk-040-agreement-gate.sql);
-- the task brief's scripts/db-walks/ path does not exist in this repo.
--
-- Assert the OUTCOME, not the mechanism (plan Phase 0 verification gate):
--   * payout_method / agreement_grace_until are trigger-protected => a forbidden
--     client UPDATE RAISES (42501); we assert it RAISES and the value is
--     UNCHANGED (NOT row_count=0 — RLS tp_update allows the row, the trigger is
--     what denies it).
--   * stripe_connect_accounts is RLS-protected for reads => non-owner/anon SELECT
--     returns 0 rows (no raise).
--   * connect_cutover_date is write-once via a sole-writer SECURITY DEFINER
--     setter => a rejected attempt is DURABLY audited (not just logged).
--
-- NOTE on the single walk transaction: set_config('app.connect_cutover_writer',
-- …, true) is txn-local, so once the setter applies, the flag stays 'on' for the
-- rest of THIS transaction. Section 5 therefore runs the "direct write RAISES"
-- checks BEFORE the first successful setter call (flag still unset), matching how
-- production behaves where each setter call is its own transaction.

BEGIN;

SET LOCAL search_path = public, extensions;

-- ── Seed ──────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('00000000-0000-4000-9000-0000000000a1', 'walk.p0.teacherA@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-9000-0000000000a2', 'walk.p0.teacherB@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-9000-0000000000ad', 'walk.p0.admin@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

INSERT INTO public.profiles (id, full_name, role, roles) VALUES
  ('00000000-0000-4000-9000-0000000000a1', 'Walk P0 TeacherA', 'teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-0000000000a2', 'Walk P0 TeacherB', 'teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-0000000000ad', 'Walk P0 Admin',    'admin',   ARRAY['admin']::public.user_role[]);

-- A profile-insert trigger auto-creates the teacher_profiles rows; upsert rate.
INSERT INTO public.teacher_profiles (teacher_id, hourly_rate) VALUES
  ('00000000-0000-4000-9000-0000000000a1', 20.00),
  ('00000000-0000-4000-9000-0000000000a2', 20.00)
ON CONFLICT (teacher_id) DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate;

-- ── 1. FR-025 default: a teacher_profiles row is 'stripe_connect' ───────────
DO $$
DECLARE m text;
BEGIN
  SELECT payout_method INTO m FROM public.teacher_profiles
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  IF m IS DISTINCT FROM 'stripe_connect' THEN
    RAISE EXCEPTION 'ASSERT FAILED: default payout_method is % (want stripe_connect)', m;
  END IF;
  RAISE NOTICE 'ASSERT OK  [1] new teacher_profiles.payout_method defaults to stripe_connect';
END $$;

-- ── 2. FR-025 column guard: a teacher CANNOT self-switch payout_method ──────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE m text;
BEGIN
  BEGIN
    UPDATE public.teacher_profiles SET payout_method = 'manual'
     WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
    RAISE EXCEPTION 'ASSERT FAILED: teacher self-switched payout_method to manual (routes around Stripe)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [2a] teacher payout_method UPDATE RAISES 42501';
  END;
  SELECT payout_method INTO m FROM public.teacher_profiles
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  IF m IS DISTINCT FROM 'stripe_connect' THEN
    RAISE EXCEPTION 'ASSERT FAILED: payout_method changed to % despite the raise', m;
  END IF;
  RAISE NOTICE 'ASSERT OK  [2b] payout_method value unchanged after the denied write';
END $$;

-- ── 2c. Narrowness control: the SAME teacher CAN edit bio (guard is scoped) ─
DO $$
DECLARE b text;
BEGIN
  UPDATE public.teacher_profiles SET bio = 'walk-edited-bio'
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  SELECT bio INTO b FROM public.teacher_profiles
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  IF b IS DISTINCT FROM 'walk-edited-bio' THEN
    RAISE EXCEPTION 'ASSERT FAILED: BEFORE UPDATE OF guard wrongly blocked a bio edit (not narrow)';
  END IF;
  RAISE NOTICE 'ASSERT OK  [2c] non-guarded column (bio) still editable by owner — guard is column-scoped';
END $$;

-- ── 2d. FR-029: a teacher CANNOT self-extend agreement_grace_until ──────────
DO $$
BEGIN
  BEGIN
    UPDATE public.teacher_profiles SET agreement_grace_until = now() + interval '999 days'
     WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
    RAISE EXCEPTION 'ASSERT FAILED: teacher self-extended agreement_grace_until (consent-gate bypass)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [2d] teacher agreement_grace_until UPDATE RAISES 42501';
  END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── 3. Trusted (direct-DB) payout_method change SUCCEEDS + audits ───────────
DO $$
DECLARE m text; n integer;
BEGIN
  UPDATE public.teacher_profiles SET payout_method = 'manual'
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  SELECT payout_method INTO m FROM public.teacher_profiles
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  IF m IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'ASSERT FAILED: trusted payout_method change did not apply (got %)', m;
  END IF;
  SELECT count(*) INTO n FROM public.connect_payout_audit
   WHERE event = 'payout_method_change'
     AND subject_teacher_id = '00000000-0000-4000-9000-0000000000a1'
     AND detail->>'old' = 'stripe_connect' AND detail->>'new' = 'manual';
  IF n <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAILED: expected 1 payout_method audit row, got %', n;
  END IF;
  RAISE NOTICE 'ASSERT OK  [3] trusted (direct-DB) payout_method change applies + writes one audit row';
END $$;

-- ── 3b. The PROD write path: an ADMIN session may change payout_method ──────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-0000000000ad","role":"authenticated"}', true);
DO $$
DECLARE m text; n integer;
BEGIN
  UPDATE public.teacher_profiles SET payout_method = 'manual'
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a2';
  SELECT payout_method INTO m FROM public.teacher_profiles
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a2';
  IF m IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'ASSERT FAILED: admin payout_method change did not apply (got %)', m;
  END IF;
  SELECT count(*) INTO n FROM public.connect_payout_audit
   WHERE event = 'payout_method_change'
     AND subject_teacher_id = '00000000-0000-4000-9000-0000000000a2'
     AND actor = '00000000-0000-4000-9000-0000000000ad';
  IF n <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAILED: expected 1 admin-actor audit row, got %', n;
  END IF;
  RAISE NOTICE 'ASSERT OK  [3b] admin session changes payout_method + audit records the admin actor';
END $$;

-- ── 3c. FR-017: a teacher reads OWN audit rows only ─────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE own integer; others integer;
BEGIN
  SELECT count(*) INTO own FROM public.connect_payout_audit;                       -- RLS-filtered
  SELECT count(*) INTO others FROM public.connect_payout_audit
   WHERE subject_teacher_id = '00000000-0000-4000-9000-0000000000a2';
  IF own <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: teacher A saw % audit rows (want 1 own)', own; END IF;
  IF others <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: teacher A saw % of teacher B''s audit rows (want 0)', others; END IF;
  RAISE NOTICE 'ASSERT OK  [3c] teacher reads own audit row (1) and none of another teacher''s (FR-017)';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── 4. FR-003 stripe_connect_accounts RLS ──────────────────────────────────
-- Insert with NULL stripe_account_id: a row is often created before Stripe
-- returns the acct_… id (drives the one-time-link test in 4d).
INSERT INTO public.stripe_connect_accounts (teacher_id, charges_enabled)
VALUES ('00000000-0000-4000-9000-0000000000a1', false);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.stripe_connect_accounts;
  IF n <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: owner read % connect-account rows (want 1)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [4a] owner reads own stripe_connect_accounts row (1)';
END $$;

SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-0000000000a2","role":"authenticated"}', true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.stripe_connect_accounts;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: non-owner read % connect-account rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [4b] non-owner reads 0 stripe_connect_accounts rows';
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SET LOCAL ROLE anon;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.stripe_connect_accounts;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: anon read % connect-account rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [4c] anon reads 0 stripe_connect_accounts rows';
END $$;
RESET ROLE;

-- ── 4d. stripe_account_id one-time link + identity/status rules ─────────────
DO $$
DECLARE acct text; ce boolean;
BEGIN
  -- NULL -> value: the one-time link SUCCEEDS.
  UPDATE public.stripe_connect_accounts SET stripe_account_id = 'acct_x'
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  SELECT stripe_account_id INTO acct FROM public.stripe_connect_accounts
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  IF acct IS DISTINCT FROM 'acct_x' THEN
    RAISE EXCEPTION 'ASSERT FAILED: NULL->acct_x link did not apply (got %)', acct;
  END IF;
  RAISE NOTICE 'ASSERT OK  [4d-i] stripe_account_id NULL->value link succeeds (one-time)';

  -- value -> other value: RAISES (never re-pointed).
  BEGIN
    UPDATE public.stripe_connect_accounts SET stripe_account_id = 'acct_y'
     WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
    RAISE EXCEPTION 'ASSERT FAILED: stripe_account_id was re-pointable acct_x->acct_y';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [4d-ii] stripe_account_id value->other RAISES (link is one-time)';
  END;

  -- status column mutable — and actually applied.
  UPDATE public.stripe_connect_accounts SET charges_enabled = true
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  SELECT charges_enabled INTO ce FROM public.stripe_connect_accounts
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  IF ce IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ASSERT FAILED: charges_enabled did not update to true (got %)', ce;
  END IF;
  RAISE NOTICE 'ASSERT OK  [4d-iii] status column (charges_enabled) is mutable and applied (=true)';

  -- teacher_id immutable: RAISES.
  BEGIN
    UPDATE public.stripe_connect_accounts
       SET teacher_id = '00000000-0000-4000-9000-0000000000a2'
     WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
    RAISE EXCEPTION 'ASSERT FAILED: stripe_connect_accounts.teacher_id was re-pointable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [4d-iv] identity column (teacher_id) is immutable';
  END;
END $$;

-- ── 4e. connect_payout_audit is append-only (UPDATE + DELETE both RAISE) ────
DO $$
BEGIN
  BEGIN
    UPDATE public.connect_payout_audit SET event = 'tampered';
    RAISE EXCEPTION 'ASSERT FAILED: audit row was UPDATE-able (not append-only)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [4e-i] audit UPDATE RAISES (append-only)';
  END;
  BEGIN
    DELETE FROM public.connect_payout_audit;
    RAISE EXCEPTION 'ASSERT FAILED: audit row was DELETE-able (not append-only)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [4e-ii] audit DELETE RAISES (append-only)';
  END;
END $$;

-- ── 5. FR-021 connect_cutover_date sole-writer setter ───────────────────────
-- 5a/5b/5c FIRST (writer flag still unset): any DIRECT write is rejected.
DO $$
BEGIN
  BEGIN
    UPDATE public.platform_settings SET value = '2030-01-01' WHERE key = 'connect_cutover_date';
    RAISE EXCEPTION 'ASSERT FAILED: direct UPDATE of cutover value was allowed (bypassed the setter)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [5a] direct UPDATE RAISES (setter is the only path)';
  END;
  BEGIN
    DELETE FROM public.platform_settings WHERE key = 'connect_cutover_date';
    RAISE EXCEPTION 'ASSERT FAILED: cutover row was directly deletable';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [5b] direct DELETE RAISES';
  END;
  BEGIN
    UPDATE public.platform_settings SET key = 'connect_cutover_date_moved'
     WHERE key = 'connect_cutover_date';
    RAISE EXCEPTION 'ASSERT FAILED: cutover key was renamable (partition could be re-armed)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [5c] direct key-rename RAISES';
  END;
END $$;

-- 5d. Invalid date on the fresh empty row → soft-refuse + DURABLE audit.
DO $$
DECLARE r text; v text; n integer;
BEGIN
  r := public.set_connect_cutover_date('not-a-date');
  IF r IS DISTINCT FROM 'rejected: invalid date' THEN
    RAISE EXCEPTION 'ASSERT FAILED: invalid date returned "%" (want rejected: invalid date)', r;
  END IF;
  SELECT value INTO v FROM public.platform_settings WHERE key = 'connect_cutover_date';
  IF COALESCE(btrim(v), '') <> '' THEN
    RAISE EXCEPTION 'ASSERT FAILED: invalid attempt changed the value to "%"', v;
  END IF;
  SELECT count(*) INTO n FROM public.connect_payout_audit
   WHERE event = 'connect_cutover_rejected' AND detail->>'reason' = 'invalid_date'
     AND detail->>'attempted' = 'not-a-date';
  IF n <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: expected 1 invalid_date reject audit row, got %', n; END IF;
  RAISE NOTICE 'ASSERT OK  [5d] invalid date soft-refused, value unchanged, rejection durably audited';
END $$;

-- 5e. The single legitimate unlock via the setter → applied + audit.
DO $$
DECLARE r text; v text; n integer;
BEGIN
  r := public.set_connect_cutover_date('2026-09-01');
  IF r IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'ASSERT FAILED: setter returned "%" (want applied)', r;
  END IF;
  SELECT value INTO v FROM public.platform_settings WHERE key = 'connect_cutover_date';
  IF v IS DISTINCT FROM '2026-09-01' THEN
    RAISE EXCEPTION 'ASSERT FAILED: cutover value is "%" after applied (want 2026-09-01)', v;
  END IF;
  SELECT count(*) INTO n FROM public.connect_payout_audit
   WHERE event = 'connect_cutover_set' AND detail->>'value' = '2026-09-01';
  IF n <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: expected 1 cutover_set audit row, got %', n; END IF;
  RAISE NOTICE 'ASSERT OK  [5e] setter applies the one-time cutover + audits';
END $$;

-- 5f. A second call → soft-refuse (already set) + DURABLE rejected audit.
--     This is the KEY FR-021 assertion: the rejected attempt PERSISTS.
DO $$
DECLARE r text; v text; n integer;
BEGIN
  r := public.set_connect_cutover_date('2026-10-01');
  IF r IS DISTINCT FROM 'rejected: already set' THEN
    RAISE EXCEPTION 'ASSERT FAILED: second setter call returned "%" (want rejected: already set)', r;
  END IF;
  SELECT value INTO v FROM public.platform_settings WHERE key = 'connect_cutover_date';
  IF v IS DISTINCT FROM '2026-09-01' THEN
    RAISE EXCEPTION 'ASSERT FAILED: second call changed value to "%" (write-once broken)', v;
  END IF;
  SELECT count(*) INTO n FROM public.connect_payout_audit
   WHERE event = 'connect_cutover_rejected' AND detail->>'reason' = 'already_set'
     AND detail->>'attempted' = '2026-10-01';
  IF n <> 1 THEN
    RAISE EXCEPTION 'ASSERT FAILED: rejected attempt was NOT durably audited (got % rows)', n;
  END IF;
  RAISE NOTICE 'ASSERT OK  [5f] second call refused + rejected attempt DURABLY audited (FR-021)';
END $$;

-- 5g. An authenticated (non-service) caller cannot EXECUTE the setter.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-0000000000ad","role":"authenticated"}', true);
DO $$
DECLARE r text;
BEGIN
  BEGIN
    r := public.set_connect_cutover_date('2026-12-01');
    RAISE EXCEPTION 'ASSERT FAILED: authenticated/admin EXECUTE of setter was allowed (returned %)', r;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [5g] authenticated EXECUTE of setter denied (service-role only)';
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- 5h. Scoping: an UNRELATED setting is still freely updatable.
DO $$
DECLARE v text;
BEGIN
  UPDATE public.platform_settings SET value = 'true'
   WHERE key = 'teacher_agreement_gate_enabled';
  SELECT value INTO v FROM public.platform_settings WHERE key = 'teacher_agreement_gate_enabled';
  IF v IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'ASSERT FAILED: sole-writer trigger leaked onto an unrelated setting';
  END IF;
  RAISE NOTICE 'ASSERT OK  [5h] unrelated platform_settings row still updatable (trigger is key-scoped)';
END $$;

-- ── 5i. FR-021 defence-in-depth: an ADMIN session cannot set the cutover even
--        by forging the sole-writer GUC — the RESTRICTIVE policy removes the row
--        from every authenticated UPDATE (0 rows, value unchanged). Without the
--        policy the forged flag would let settings_update (is_admin) write it. ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('role','authenticated','sub','00000000-0000-4000-9000-0000000000ad')::text, true);
DO $$
DECLARE v_before text; v_after text; n integer;
BEGIN
  SELECT value INTO v_before FROM public.platform_settings WHERE key = 'connect_cutover_date';
  PERFORM set_config('app.connect_cutover_writer', 'on', true);  -- forge the sole-writer flag
  BEGIN
    UPDATE public.platform_settings SET value = '2026-12-31' WHERE key = 'connect_cutover_date';
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT value INTO v_after FROM public.platform_settings WHERE key = 'connect_cutover_date';
    IF n <> 0 OR v_after IS DISTINCT FROM v_before THEN
      RAISE EXCEPTION 'ASSERT FAILED: admin forged the flag and wrote cutover (rows=%, %->%)', n, v_before, v_after;
    END IF;
    RAISE NOTICE 'ASSERT OK  [5i] admin cannot set cutover even with a forged writer flag (restrictive RLS, 0 rows)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [5i] admin cannot set cutover even with a forged writer flag (denied)';
  END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

ROLLBACK;
