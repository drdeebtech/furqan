-- Rolled-back verification walk for
-- 20260731000000_connect_accounts_and_payout_method.sql
-- (spec 040 Phase 0 — FR-003 / FR-025 / FR-021). Run:
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
--   * connect_cutover_date is write-once via trigger => the second write RAISES.

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
  -- Value must be UNCHANGED.
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
-- This is the real production write (admin switches a teacher to manual). The
-- guard's is_admin() branch must ALLOW it and stamp the admin as the actor.
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
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── 4. FR-003 stripe_connect_accounts RLS ──────────────────────────────────
INSERT INTO public.stripe_connect_accounts (teacher_id, stripe_account_id, charges_enabled)
VALUES ('00000000-0000-4000-9000-0000000000a1', 'acct_walk_A', false);

-- Owner reads own row.
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

-- Non-owner reads none.
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

-- Anon reads none.
SET LOCAL ROLE anon;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.stripe_connect_accounts;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: anon read % connect-account rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [4c] anon reads 0 stripe_connect_accounts rows';
END $$;
RESET ROLE;

-- ── 4d. Identity freeze: status column mutable, identity immutable ──────────
DO $$
BEGIN
  UPDATE public.stripe_connect_accounts SET charges_enabled = true
   WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
  RAISE NOTICE 'ASSERT OK  [4d-i] status column (charges_enabled) is mutable';
  BEGIN
    UPDATE public.stripe_connect_accounts
       SET teacher_id = '00000000-0000-4000-9000-0000000000a2'
     WHERE teacher_id = '00000000-0000-4000-9000-0000000000a1';
    RAISE EXCEPTION 'ASSERT FAILED: stripe_connect_accounts.teacher_id was re-pointable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [4d-ii] identity column (teacher_id) is immutable';
  END;
END $$;

-- ── 5. FR-021 connect_cutover_date write-once ──────────────────────────────
-- 5a. Cannot blank the still-empty row (NEW empty rejected).
DO $$
BEGIN
  BEGIN
    UPDATE public.platform_settings SET value = '' WHERE key = 'connect_cutover_date';
    RAISE EXCEPTION 'ASSERT FAILED: blanking the empty cutover value was allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [5a] blanking connect_cutover_date rejected';
  END;
END $$;

-- 5b. The single legitimate unlock '' -> value SUCCEEDS + audits.
DO $$
DECLARE v text; n integer;
BEGIN
  UPDATE public.platform_settings SET value = '2026-08-01'
   WHERE key = 'connect_cutover_date';
  SELECT value INTO v FROM public.platform_settings WHERE key = 'connect_cutover_date';
  IF v IS DISTINCT FROM '2026-08-01' THEN
    RAISE EXCEPTION 'ASSERT FAILED: cutover unlock did not apply (got %)', v;
  END IF;
  SELECT count(*) INTO n FROM public.connect_payout_audit
   WHERE event = 'connect_cutover_set' AND detail->>'value' = '2026-08-01';
  IF n <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: expected 1 cutover audit row, got %', n; END IF;
  RAISE NOTICE 'ASSERT OK  [5b] single empty->value cutover write applies + audits';
END $$;

-- 5c. A second write RAISES (already set).
DO $$
BEGIN
  BEGIN
    UPDATE public.platform_settings SET value = '2026-09-01'
     WHERE key = 'connect_cutover_date';
    RAISE EXCEPTION 'ASSERT FAILED: cutover value was changed after being set (not write-once)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [5c] second cutover write RAISES (write-once)';
  END;
END $$;

-- 5d. DELETE RAISES.
DO $$
BEGIN
  BEGIN
    DELETE FROM public.platform_settings WHERE key = 'connect_cutover_date';
    RAISE EXCEPTION 'ASSERT FAILED: cutover row was deletable';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [5d] cutover DELETE RAISES';
  END;
END $$;

-- 5e. Key-RENAME away from the target RAISES (FR-021: reject ANY later mutation).
DO $$
BEGIN
  BEGIN
    UPDATE public.platform_settings SET key = 'connect_cutover_date_moved'
     WHERE key = 'connect_cutover_date';
    RAISE EXCEPTION 'ASSERT FAILED: cutover key was renamable (partition could be re-armed)';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ASSERT OK  [5e] cutover key-rename RAISES (write-once covers renames)';
  END;
END $$;

-- 5f. Scoping: an UNRELATED setting is still freely updatable.
DO $$
DECLARE v text;
BEGIN
  UPDATE public.platform_settings SET value = 'true'
   WHERE key = 'teacher_agreement_gate_enabled';
  SELECT value INTO v FROM public.platform_settings WHERE key = 'teacher_agreement_gate_enabled';
  IF v IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'ASSERT FAILED: write-once trigger leaked onto an unrelated setting';
  END IF;
  RAISE NOTICE 'ASSERT OK  [5f] unrelated platform_settings row still updatable (trigger is key-scoped)';
END $$;

ROLLBACK;
