-- 20260531234212_restore_admin_reviews_update_policy.sql
--
-- Audit finding H4: the canonical-policy merge (20260429051910) recreated
-- reviews_update with only `auth.uid() = student_id OR auth.uid() = teacher_id`
-- and the prior "Admins full access to reviews" policy had been dropped in
-- 20260428210029 (which kept only admin_delete_review). Result: an admin who is
-- neither the student nor the teacher matches zero rows on UPDATE, so
-- toggleReviewPublic (which runs under the user RLS client) silently no-ops and
-- reports success — admin hide-without-delete moderation is broken.
--
-- Restore the admin disjunct, matching the private.is_admin() pattern used by
-- profiles_update in the same merge migration.

drop policy if exists reviews_update on public.reviews;

create policy reviews_update on public.reviews
  for update
  using (
    (select private.is_admin())
    or (select auth.uid()) = student_id
    or (select auth.uid()) = teacher_id
  );
