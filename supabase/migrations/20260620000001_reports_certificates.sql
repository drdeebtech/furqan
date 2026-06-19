-- 20260620000001_reports_certificates.sql
--
-- Spec 023 (م٦) — foundational schema for guardian reports, certificates,
-- honor board, and teacher notes.
--
-- Adds 4 new tables:
--   teacher_notes       — per-student teacher-authored notes (guardian-readable)
--   monthly_reports     — one (versioned) per student per closed subscription month
--   certificates        — simple appreciation / course-completion artifacts (NOT ijazah)
--   honor_board_entries — display-safe ranking snapshot, opt-out-aware
--
-- All 4 tables ship RLS in this same migration (constitution §3 + FR-018).
-- System-generated artifacts (monthly_reports, certificates, honor_board_entries)
-- are service-role-only writes; teacher_notes allows teacher INSERT/UPDATE.
-- BEFORE UPDATE OF identity guards on certificates/monthly_reports/honor_board_entries
-- per FR-020 (service-role/migrations exempt).
--
-- Constitution compliance (AGENTS.md §3 + §4):
--   • RLS enabled + policies same migration.
--   • `(select auth.uid())` initplan pattern, `private.is_admin()` for admin reads.
--   • PK uuid, FKs to public.profiles(id), public.set_updated_at() trigger.
--   • service_role key server-only — system artifacts write via service-role only.
--   • Typed FurqanEvent names (no string literals in app code; SQL type is fine).
-- Idempotent (CREATE TABLE IF NOT EXISTS, drop-if-exists for constraints/types).

-- ────────────────────────────────────────────────────────────────────────────
-- 0. teacher_notes
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.teacher_notes (
  id          uuid        primary key default gen_random_uuid(),
  student_id  uuid        not null references public.profiles(id) on delete cascade,
  teacher_id  uuid        not null references public.profiles(id) on delete cascade,
  content     text        not null check (char_length(content) between 1 and 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_teacher_notes_student on public.teacher_notes(student_id);
create index if not exists idx_teacher_notes_teacher on public.teacher_notes(teacher_id);
drop trigger if exists t_teacher_notes_upd on public.teacher_notes;
create trigger t_teacher_notes_upd
  before update on public.teacher_notes
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 1. monthly_reports (versioned append per CHK024 / clarified 2026-06-19)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.monthly_reports (
  id                       uuid        primary key default gen_random_uuid(),
  student_id               uuid        not null references public.profiles(id) on delete cascade,
  subscription_id          uuid        references public.subscriptions(id) on delete set null,
  period_year              integer     not null,
  period_month             integer     not null check (period_month between 1 and 12),
  version                  integer     not null default 1 check (version >= 1),
  level_assessment_summary text,
  generated_at             timestamptz not null default now(),
  created_at               timestamptz not null default now()
);
-- Versioned composite UNIQUE: corrections append rather than fail.
create unique index if not exists uix_monthly_reports_student_period_version
  on public.monthly_reports(student_id, period_year, period_month, version);
create index if not exists idx_monthly_reports_student_period
  on public.monthly_reports(student_id, period_year, period_month);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. certificates (composite UNIQUE per CHK047 / clarified 2026-06-19)
-- ────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.certificate_type as enum (
    'appreciation_juz',
    'appreciation_level',
    'course_completion'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.certificates (
  id                uuid              primary key default gen_random_uuid(),
  student_id        uuid              not null references public.profiles(id) on delete cascade,
  certificate_type  public.certificate_type not null,
  -- Plain per-type values per CHK047: juz='1'..'30', level=level-id, course=course-id.
  -- The certificate_type column disambiguates so plain values cannot collide.
  milestone_key     text              not null,
  cited_range_start text              not null,  -- 'surah:ayah' from src/lib/quran/ayah-counts.ts
  cited_range_end   text              not null,  -- 'surah:ayah' from src/lib/quran/ayah-counts.ts
  issued_at         timestamptz       not null default now(),
  created_at        timestamptz       not null default now()
);
create unique index if not exists uix_certificates_student_milestone
  on public.certificates(student_id, certificate_type, milestone_key);
create index if not exists idx_certificates_student
  on public.certificates(student_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. honor_board_entries (display-safe snapshot; achievement_metric nullable
--    until FR-010 metric formula is defined — /speckit-analyze C1/C4 sized)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.honor_board_entries (
  id                uuid        primary key default gen_random_uuid(),
  student_id        uuid        not null references public.profiles(id) on delete cascade,
  -- Display-safe allow-list per /speckit-analyze L1: only these 4 columns
  -- are exposed publicly. No email/phone/dob/address/PII.
  display_name      text,
  avatar_url        text,
  achievement_metric numeric,   -- NULL until FR-010 product-owner decision; sizing per plan §7
  rank_period       date        not null,
  is_opted_out      boolean     not null default false,
  computed_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  -- One snapshot row per student per rank_period (replaced atomically per refresh; plan §7).
  unique (student_id, rank_period)
);
-- Partial index: only opted-in students appear in board reads.
create index if not exists idx_honor_board_visible
  on public.honor_board_entries(rank_period desc, achievement_metric desc nulls last)
  where is_opted_out = false;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS — enable + policies (FR-018/FR-019)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.teacher_notes        enable row level security;
alter table public.monthly_reports      enable row level security;
alter table public.certificates         enable row level security;
alter table public.honor_board_entries  enable row level security;

-- teacher_notes: teacher writes own; student + linked guardian read own's; admin all.
create policy "teacher_notes_select_self_or_guardian_or_admin"
  on public.teacher_notes for select
  to authenticated
  using (
    teacher_id = (select auth.uid())
    or student_id = (select auth.uid())
    or student_id in (
      select gc.child_id from public.guardian_children gc
      where gc.guardian_id = (select auth.uid())
    )
    or private.is_admin()
  );
create policy "teacher_notes_insert_own_teacher"
  on public.teacher_notes for insert
  to authenticated
  with check (teacher_id = (select auth.uid()) or private.is_admin());
create policy "teacher_notes_update_own_teacher"
  on public.teacher_notes for update
  to authenticated
  using (teacher_id = (select auth.uid()) or private.is_admin())
  with check (teacher_id = (select auth.uid()) or private.is_admin());

-- monthly_reports: student + linked guardian read own; service-role INSERT only
-- (no client INSERT/UPDATE/DELETE policy — fully immutable from the client).
create policy "monthly_reports_select_self_or_guardian_or_admin"
  on public.monthly_reports for select
  to authenticated
  using (
    student_id = (select auth.uid())
    or student_id in (
      select gc.child_id from public.guardian_children gc
      where gc.guardian_id = (select auth.uid())
    )
    or private.is_admin()
  );

-- certificates: student + linked guardian read own; service-role INSERT only.
create policy "certificates_select_self_or_guardian_or_admin"
  on public.certificates for select
  to authenticated
  using (
    student_id = (select auth.uid())
    or student_id in (
      select gc.child_id from public.guardian_children gc
      where gc.guardian_id = (select auth.uid())
    )
    or private.is_admin()
  );

-- honor_board_entries: authenticated SELECT only opted-in rows; student may
-- UPDATE only their own is_opted_out (identity cols guarded by trigger below).
create policy "honor_board_select_opted_in"
  on public.honor_board_entries for select
  to authenticated
  using (is_opted_out = false or student_id = (select auth.uid()) or private.is_admin());
create policy "honor_board_update_own_optout"
  on public.honor_board_entries for update
  to authenticated
  using (student_id = (select auth.uid()) or private.is_admin())
  with check (student_id = (select auth.uid()) or private.is_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- 5. BEFORE UPDATE OF identity guards (FR-020) — defense-in-depth
--    Even though no client UPDATE policy is granted on monthly_reports /
--    certificates, ship the guard per the platform "guard columns, not just
--    transitions" rule. Service-role + migrations exempt via the canonical
--    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
--    bypass idiom (matches 20260619000001_single_session_columns.sql).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function private.guard_monthly_reports_identity_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if v_jwt_role is null or v_jwt_role = 'service_role' or private.is_admin() then
    return new;
  end if;
  if new.student_id is distinct from old.student_id
     or new.period_year is distinct from old.period_year
     or new.period_month is distinct from old.period_month
     or new.version is distinct from old.version then
    raise exception 'monthly_reports identity columns are immutable after creation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
alter function private.guard_monthly_reports_identity_change() owner to postgres;
drop trigger if exists t_guard_monthly_reports_identity on public.monthly_reports;
create trigger t_guard_monthly_reports_identity
  before update of student_id, period_year, period_month, version on public.monthly_reports
  for each row execute function private.guard_monthly_reports_identity_change();

create or replace function private.guard_certificates_identity_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if v_jwt_role is null or v_jwt_role = 'service_role' or private.is_admin() then
    return new;
  end if;
  if new.student_id is distinct from old.student_id
     or new.certificate_type is distinct from old.certificate_type
     or new.milestone_key is distinct from old.milestone_key
     or new.cited_range_start is distinct from old.cited_range_start
     or new.cited_range_end is distinct from old.cited_range_end then
    raise exception 'certificate identity/range columns are immutable after creation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
alter function private.guard_certificates_identity_change() owner to postgres;
drop trigger if exists t_guard_certificates_identity on public.certificates;
create trigger t_guard_certificates_identity
  before update of student_id, certificate_type, milestone_key, cited_range_start, cited_range_end
  on public.certificates
  for each row execute function private.guard_certificates_identity_change();

create or replace function private.guard_honor_board_identity_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_jwt_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if v_jwt_role is null or v_jwt_role = 'service_role' or private.is_admin() then
    return new;
  end if;
  -- Students may flip is_opted_out only; display_name / achievement_metric /
  -- rank_period / student_id are platform-computed and immutable from the client.
  if new.student_id is distinct from old.student_id
     or new.display_name is distinct from old.display_name
     or new.achievement_metric is distinct from old.achievement_metric
     or new.rank_period is distinct from old.rank_period then
    raise exception 'honor_board_entries identity/metric columns are immutable from client (only is_opted_out is settable)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
alter function private.guard_honor_board_identity_change() owner to postgres;
drop trigger if exists t_guard_honor_board_identity on public.honor_board_entries;
create trigger t_guard_honor_board_identity
  before update of student_id, display_name, achievement_metric, rank_period
  on public.honor_board_entries
  for each row execute function private.guard_honor_board_identity_change();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. platform_settings seed (default values; admin adjusts in dashboard)
-- ────────────────────────────────────────────────────────────────────────────
insert into public.platform_settings (key, value, description) values
  ('honor_board_refresh_cadence_days', '7', 'Spec 023: days between honor-board recomputes (plan §7 sizing).'),
  ('notifications_whatsapp_enabled', 'true', 'Spec 023: global WhatsApp feature flag; per-trigger matrix in notification_channel_matrix still applies.'),
  ('subscription_expiring_lead_days', '7', 'Spec 023: days before period end the "continue?" prompt fires (CHK015).'),
  ('notification_channel_matrix', '{}', 'Spec 023: JSON map trigger → channel[] overriding FR-012 defaults. Empty {} = use FR-012 matrix defaults.')
on conflict (key) do nothing;
