-- Rolled-back verification walk for 20260730000000_teacher_agreement_gate.sql
-- (spec 040 FR-028/FR-029). Run:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f scripts/walk-040-agreement-gate.sql
-- Every assertion RAISEs on failure; the whole walk rolls back.
--
-- The load-bearing assertion is [2]: with the gate DISABLED (its shipped
-- default), teacher_agreement_gate_ok returns true for a teacher with no
-- acceptance and no grace — i.e. deploying this migration cannot freeze a
-- single live booking. Everything else proves the gate does its job once ON.

BEGIN;

SET LOCAL search_path = public, extensions;

-- ── Seed ────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
  ('00000000-0000-4000-9000-00000000000a', 'walk.teacherA@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-9000-00000000000b', 'walk.teacherB@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-9000-00000000000c', 'walk.student@test.local',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

INSERT INTO public.profiles (id, full_name, role, roles) VALUES
  ('00000000-0000-4000-9000-00000000000a', 'Walk TeacherA', 'teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-00000000000b', 'Walk TeacherB', 'teacher', ARRAY['teacher']::public.user_role[]),
  ('00000000-0000-4000-9000-00000000000c', 'Walk Student',  'student', ARRAY['student']::public.user_role[]);

-- A profile-insert trigger auto-creates teacher_profiles rows for new teachers,
-- so upsert the rate rather than insert (which would collide).
INSERT INTO public.teacher_profiles (teacher_id, hourly_rate) VALUES
  ('00000000-0000-4000-9000-00000000000a', 20.00),
  ('00000000-0000-4000-9000-00000000000b', 20.00)
ON CONFLICT (teacher_id) DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate;

-- Teacher A has a CONFIRMED booking (an "existing active teacher" at rollout);
-- Teacher B has none (a "new onboarding"). This drives the FR-029 backfill.
INSERT INTO public.bookings (id, student_id, teacher_id, duration_min, rate_snapshot, amount_usd, scheduled_at, status) VALUES
  ('00000000-0000-4000-9000-0000000000b1', '00000000-0000-4000-9000-00000000000c',
   '00000000-0000-4000-9000-00000000000a', 30, 20.00, 10.00, now() - interval '2 days', 'confirmed');

-- ── 1. FR-029 grace backfill logic ──────────────────────────────────────
-- The migration's one-time backfill ran against an empty table at reset; re-run
-- the SAME statement against seeded data to prove it stamps the right teachers.
UPDATE public.teacher_profiles tp
   SET agreement_grace_until = now() + interval '30 days'
 WHERE tp.agreement_grace_until IS NULL
   AND EXISTS (SELECT 1 FROM public.bookings b
                WHERE b.teacher_id = tp.teacher_id AND b.status = 'confirmed');

DO $$
DECLARE grace_a timestamptz; grace_b timestamptz;
BEGIN
  SELECT agreement_grace_until INTO grace_a FROM public.teacher_profiles
   WHERE teacher_id = '00000000-0000-4000-9000-00000000000a';
  SELECT agreement_grace_until INTO grace_b FROM public.teacher_profiles
   WHERE teacher_id = '00000000-0000-4000-9000-00000000000b';
  IF grace_a IS NULL OR grace_a <= now() THEN
    RAISE EXCEPTION 'ASSERT FAILED: active teacher A did not get a future grace deadline (got %)', grace_a;
  END IF;
  IF grace_b IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERT FAILED: new teacher B was wrongly granted grace (%)', grace_b;
  END IF;
  RAISE NOTICE 'ASSERT OK  [1] backfill: existing teacher gets 30d grace, new teacher gets none';
END $$;

-- ── 2. DORMANT BY DEFAULT — the migration cannot freeze bookings ─────────
DO $$
BEGIN
  IF NOT public.teacher_agreement_gate_ok('00000000-0000-4000-9000-00000000000b') THEN
    RAISE EXCEPTION 'ASSERT FAILED: gate DISABLED but blocked teacher B — shipping this migration would freeze bookings';
  END IF;
  RAISE NOTICE 'ASSERT OK  [2] gate disabled (default) → passes even with no acceptance and no grace (dormant)';
END $$;

-- ── 3. Enable the gate; from here the acceptance/grace logic applies ─────
UPDATE public.platform_settings SET value = 'true'
 WHERE key = 'teacher_agreement_gate_enabled';

DO $$
BEGIN
  -- B: no acceptance, no grace → blocked.
  IF public.teacher_agreement_gate_ok('00000000-0000-4000-9000-00000000000b') THEN
    RAISE EXCEPTION 'ASSERT FAILED: enabled gate passed teacher B with no acceptance and no grace';
  END IF;
  RAISE NOTICE 'ASSERT OK  [3a] enabled + no acceptance + no grace → blocked';

  -- A: within grace → allowed even without acceptance.
  IF NOT public.teacher_agreement_gate_ok('00000000-0000-4000-9000-00000000000a') THEN
    RAISE EXCEPTION 'ASSERT FAILED: enabled gate blocked teacher A who is within grace';
  END IF;
  RAISE NOTICE 'ASSERT OK  [3b] enabled + within grace → allowed (existing teacher not frozen)';
END $$;

-- B accepts the current version.
INSERT INTO public.teacher_agreement_acceptances (teacher_id, agreement_version, accepted_by)
VALUES ('00000000-0000-4000-9000-00000000000b', '1', '00000000-0000-4000-9000-00000000000b');

DO $$
BEGIN
  IF NOT public.teacher_agreement_gate_ok('00000000-0000-4000-9000-00000000000b') THEN
    RAISE EXCEPTION 'ASSERT FAILED: teacher B accepted current version but is still blocked';
  END IF;
  RAISE NOTICE 'ASSERT OK  [3c] enabled + accepted current version → allowed';
END $$;

-- Bump the current version: B's acceptance of '1' no longer counts.
UPDATE public.platform_settings SET value = '2'
 WHERE key = 'teacher_agreement_current_version';

DO $$
BEGIN
  IF public.teacher_agreement_gate_ok('00000000-0000-4000-9000-00000000000b') THEN
    RAISE EXCEPTION 'ASSERT FAILED: version bumped to 2 but stale acceptance of 1 still passed B';
  END IF;
  RAISE NOTICE 'ASSERT OK  [3d] version bump invalidates the old acceptance (re-acceptance required)';
END $$;

-- Expire A's grace: now with no acceptance A is blocked.
UPDATE public.teacher_profiles SET agreement_grace_until = now() - interval '1 day'
 WHERE teacher_id = '00000000-0000-4000-9000-00000000000a';

DO $$
BEGIN
  IF public.teacher_agreement_gate_ok('00000000-0000-4000-9000-00000000000a') THEN
    RAISE EXCEPTION 'ASSERT FAILED: teacher A grace expired and no acceptance, but gate still passed';
  END IF;
  RAISE NOTICE 'ASSERT OK  [3e] expired grace + no acceptance → blocked (hard gate takes over)';
END $$;

-- ── 4. UNIQUE (teacher, version): re-accepting is a no-op, not a dup ──────
DO $$
BEGIN
  BEGIN
    INSERT INTO public.teacher_agreement_acceptances (teacher_id, agreement_version, accepted_by)
    VALUES ('00000000-0000-4000-9000-00000000000b', '1', '00000000-0000-4000-9000-00000000000b');
    RAISE EXCEPTION 'ASSERT FAILED: duplicate (teacher, version) acceptance accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'ASSERT OK  [4] duplicate acceptance for one version rejected (replay-safe)';
  END;
END $$;

-- ── 5. Append-only: an acceptance cannot be modified ─────────────────────
DO $$
BEGIN
  BEGIN
    UPDATE public.teacher_agreement_acceptances SET agreement_version = '99'
     WHERE teacher_id = '00000000-0000-4000-9000-00000000000b';
    RAISE EXCEPTION 'ASSERT FAILED: acceptance row was mutable (consent evidence forgeable)';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ASSERT FAILED%' THEN RAISE; END IF;
    RAISE NOTICE 'ASSERT OK  [5] acceptance UPDATE raises (append-only consent evidence)';
  END;
END $$;

-- ── 6. RLS: owner reads own acceptance, non-owner and anon read none ──────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-00000000000b","role":"authenticated"}', true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.teacher_agreement_acceptances;
  IF n <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: owner read % own acceptance rows (want 1)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [6a] owner reads own acceptance (1 row)';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-9000-00000000000a","role":"authenticated"}', true);
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.teacher_agreement_acceptances;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: non-owner read % acceptance rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [6b] non-owner reads 0 acceptances';

  BEGIN
    INSERT INTO public.teacher_agreement_acceptances (teacher_id, agreement_version, accepted_by)
    VALUES ('00000000-0000-4000-9000-00000000000a', '2', '00000000-0000-4000-9000-00000000000a');
    RAISE EXCEPTION 'ASSERT FAILED: authenticated client INSERT into acceptances was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'ASSERT OK  [6c] authenticated client INSERT denied (service-role only)';
    WHEN check_violation THEN
      RAISE EXCEPTION 'ASSERT FAILED: INSERT reached a CHECK — RLS did not block the client write';
  END;
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.teacher_agreement_acceptances;
  IF n <> 0 THEN RAISE EXCEPTION 'ASSERT FAILED: anon read % acceptance rows (want 0)', n; END IF;
  RAISE NOTICE 'ASSERT OK  [7] anonymous reads 0 acceptances';
END $$;
RESET ROLE;

ROLLBACK;
