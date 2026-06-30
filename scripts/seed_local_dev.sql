-- Local dev seed — login-able teacher + student accounts with populated profiles.
-- LOCAL ONLY. Idempotent (fixed UUIDs + ON CONFLICT). Re-running is safe.
-- Password for every seeded account: Password123!
--
-- Run:  psql -v ON_ERROR_STOP=1 -v allow_seed=1 "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/seed_local_dev.sql
--
-- Scope: auth.users + auth.identities + profiles only. Transactional content
-- (bookings, sessions, payments, progress/SM-2) is intentionally NOT seeded
-- here — that chain has money + Quran-integrity constraints and should be
-- created through the app's own flows, not hand-written rows.

-- Safety: this script plants known-password accounts into auth.*. It refuses to
-- run unless the caller explicitly confirms a LOCAL target by passing
-- -v allow_seed=1. (A loopback/IP check is unreliable here — local Supabase runs
-- Postgres in Docker, so the backend reports a private container IP, not 127.x.)
-- The flag forces a conscious "yes, this is local" before any write.
\if :{?allow_seed}
\else
do $$ begin
  raise exception 'seed_local_dev.sql aborted: pass  -v allow_seed=1  to confirm a LOCAL Postgres before seeding known-password auth.* accounts';
end $$;
\endif

begin;

-- 1) auth.users (GoTrue). bf-hashed password so the accounts can actually log in.
with seed(id, email, role_meta, full_name, full_name_ar, country) as (
  values
    ('11111111-0000-4000-8000-000000000001'::uuid, 'teacher1@furqan.test', 'teacher', 'Ustadh Ahmad',  'الأستاذ أحمد',   'EG'),
    ('11111111-0000-4000-8000-000000000002'::uuid, 'teacher2@furqan.test', 'teacher', 'Ustadha Maryam','الأستاذة مريم',  'SA'),
    ('11111111-0000-4000-8000-000000000003'::uuid, 'teacher3@furqan.test', 'teacher', 'Ustadh Bilal',  'الأستاذ بلال',   'PK'),
    ('22222222-0000-4000-8000-000000000001'::uuid, 'student1@furqan.test', 'student', 'Yusuf Khan',    'يوسف خان',       'GB'),
    ('22222222-0000-4000-8000-000000000002'::uuid, 'student2@furqan.test', 'student', 'Aisha Rahman',  'عائشة رحمن',      'US'),
    ('22222222-0000-4000-8000-000000000003'::uuid, 'student3@furqan.test', 'student', 'Omar Farooq',   'عمر فاروق',       'AE'),
    ('22222222-0000-4000-8000-000000000004'::uuid, 'student4@furqan.test', 'student', 'Fatima Ali',    'فاطمة علي',       'CA'),
    ('22222222-0000-4000-8000-000000000005'::uuid, 'student5@furqan.test', 'student', 'Zaid Hassan',   'زيد حسن',        'MY')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000', s.id, 'authenticated', 'authenticated', s.email,
  crypt('Password123!', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('role', s.role_meta, 'full_name', s.full_name),
  false, false
from seed s
-- Reconcile mutable auth fields on rerun so a partially-seeded DB always lands
-- in the documented Password123! login state.
on conflict (id) do update set
  email              = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  updated_at         = now(),
  raw_app_meta_data  = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data;

-- 2) auth.identities — required for a complete email/password login.
with seed(id, email) as (
  values
    ('11111111-0000-4000-8000-000000000001'::uuid, 'teacher1@furqan.test'),
    ('11111111-0000-4000-8000-000000000002'::uuid, 'teacher2@furqan.test'),
    ('11111111-0000-4000-8000-000000000003'::uuid, 'teacher3@furqan.test'),
    ('22222222-0000-4000-8000-000000000001'::uuid, 'student1@furqan.test'),
    ('22222222-0000-4000-8000-000000000002'::uuid, 'student2@furqan.test'),
    ('22222222-0000-4000-8000-000000000003'::uuid, 'student3@furqan.test'),
    ('22222222-0000-4000-8000-000000000004'::uuid, 'student4@furqan.test'),
    ('22222222-0000-4000-8000-000000000005'::uuid, 'student5@furqan.test')
)
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  s.id::text, s.id,
  jsonb_build_object('sub', s.id::text, 'email', s.email, 'email_verified', true),
  'email', now(), now(), now()
from seed s
on conflict (provider, provider_id) do update set
  identity_data = excluded.identity_data,
  updated_at    = now();

-- 3) profiles — the on_auth_user_created trigger creates a base row; force the
-- role + names so browse/list pages and role routing work deterministically.
with seed(id, role_v, full_name, full_name_ar, country, hourly) as (
  values
    ('11111111-0000-4000-8000-000000000001'::uuid, 'teacher', 'Ustadh Ahmad',  'الأستاذ أحمد',  'EG', 18),
    ('11111111-0000-4000-8000-000000000002'::uuid, 'teacher', 'Ustadha Maryam','الأستاذة مريم', 'SA', 22),
    ('11111111-0000-4000-8000-000000000003'::uuid, 'teacher', 'Ustadh Bilal',  'الأستاذ بلال',  'PK', 15),
    ('22222222-0000-4000-8000-000000000001'::uuid, 'student', 'Yusuf Khan',    'يوسف خان',      'GB', null),
    ('22222222-0000-4000-8000-000000000002'::uuid, 'student', 'Aisha Rahman',  'عائشة رحمن',     'US', null),
    ('22222222-0000-4000-8000-000000000003'::uuid, 'student', 'Omar Farooq',   'عمر فاروق',      'AE', null),
    ('22222222-0000-4000-8000-000000000004'::uuid, 'student', 'Fatima Ali',    'فاطمة علي',      'CA', null),
    ('22222222-0000-4000-8000-000000000005'::uuid, 'student', 'Zaid Hassan',   'زيد حسن',       'MY', null)
)
insert into public.profiles (id, role, full_name, full_name_ar, country, hourly_rate_usd, is_active)
select s.id, s.role_v::user_role, s.full_name, s.full_name_ar, s.country, s.hourly, true
from seed s
on conflict (id) do update set
  role = excluded.role,
  full_name = excluded.full_name,
  full_name_ar = excluded.full_name_ar,
  country = excluded.country,
  hourly_rate_usd = excluded.hourly_rate_usd,
  is_active = true;

commit;

select
  role,
  count(*)
from public.profiles
where
  id::text like '11111111-%'
  or id::text like '22222222-%'
group by role;
