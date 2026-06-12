-- 20260512113251_enable_courses_feature.sql
-- Flip the courses_enabled master toggle to true.
--
-- The recorded-courses platform was seeded OFF in
-- `20260429060240_create_courses_schema.sql` and stayed off through
-- the 05-04 audit (Bad-list item #12: /teacher/courses showed the
-- "Beta feature — courses you create here are saved and visible to
-- you. They'll appear to students once an admin enables the feature."
-- copy added by PR #280 because the flag was off).
--
-- Decision (2026-05-12): flip on. The feature is fully implemented
-- (status badges, query, error handling all shipped) and the teacher
-- surface has been waiting for the admin go-ahead.
--
-- paid_courses_enabled stays off — Stripe Checkout for paid courses
-- is a separate decision and gated independently.

update public.platform_settings
   set value = 'true',
       updated_at = now()
 where key = 'courses_enabled';

-- Safety net for fresh stage / preview DBs where the original seed
-- ran with `on conflict do nothing` but the row was somehow missing.
-- Idempotent.
insert into public.platform_settings (key, value, description, updated_at)
values
  ('courses_enabled', 'true',
   'Master toggle for the recorded courses platform. Hides nav links + blocks /courses route when off.',
   now())
on conflict (key) do nothing;
