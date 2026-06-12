-- 20260601085510_add_with_check_reviews_profiles_update.sql
--
-- Audit follow-up (deferred from #334): the reviews_update and profiles_update
-- RLS policies are USING-only (no WITH CHECK). Without WITH CHECK, a row a user
-- may update can be rewritten to values that fail the same predicate — e.g. a
-- student/teacher could change reviews.student_id/teacher_id, or a user could
-- change profiles.id, to point at a row they couldn't otherwise touch. Mirror
-- the USING predicate into WITH CHECK (defense-in-depth; same predicate, so no
-- legitimate self-update breaks).

-- ─── reviews_update ─────────────────────────────────────────────────────────
drop policy if exists reviews_update on public.reviews;
create policy reviews_update on public.reviews
  for update
  using (
    (select private.is_admin())
    or (select auth.uid()) = student_id
    or (select auth.uid()) = teacher_id
  )
  with check (
    (select private.is_admin())
    or (select auth.uid()) = student_id
    or (select auth.uid()) = teacher_id
  );

-- ─── profiles_update ────────────────────────────────────────────────────────
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update
  using (
    (select private.is_admin())
    or (select auth.uid()) = id
  )
  with check (
    (select private.is_admin())
    or (select auth.uid()) = id
  );
