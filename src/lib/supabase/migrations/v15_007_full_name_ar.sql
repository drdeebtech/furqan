-- v15_007_full_name_ar.sql
--
-- Add a manual Arabic-name column to profiles. Without it the public
-- teachers page falls back to the English `full_name` even when the UI
-- is in Arabic, because we have no way to know how the teacher's name
-- should be written in Arabic (transliteration is unreliable and a name
-- belongs to its owner). With this column the admin can type the
-- preferred Arabic spelling, and the public page picks it up.
--
-- The column is nullable on purpose: existing teachers fall back to
-- `full_name` until an admin fills it in.

alter table public.profiles add column if not exists full_name_ar text;

comment on column public.profiles.full_name_ar is
  'Manually-entered Arabic spelling of the user''s name. Used for public/admin display when lang=ar. Falls back to full_name when null.';

-- v_teachers needs the new column too. Views can''t ALTER added columns,
-- so drop+recreate. Same body as v15_006 plus p.full_name_ar.
drop view if exists public.v_teachers cascade;

create or replace view public.v_teachers
with (security_invoker = true)
as
select
  tp.teacher_id,
  p.full_name,
  p.full_name_ar,
  p.phone,
  tp.cv_status,
  tp.is_archived,
  tp.is_accepting,
  tp.hourly_rate,
  tp.rating_avg,
  tp.total_sessions,
  tp.specialties,
  tp.recitation_standards,
  tp.gender,
  tp.bio,
  tp.bio_en,
  tp.intro_video_url,
  tp.cv_reviewed_at,
  tp.created_at
from public.teacher_profiles tp
left join public.profiles p on p.id = tp.teacher_id;

comment on view public.v_teachers is
  'Browseable teacher list — joins teacher_profiles + profiles (incl. Arabic name). Read-only.';

insert into schema_migrations (version, description)
  values ('v15_007', 'Add profiles.full_name_ar for manual Arabic name entry')
  on conflict do nothing;
