-- Fix 3.1 (spec 012 P2): fix resources_student_via_assignment correlation bug.
--
-- The policy qual was (ra.resource_id = ra.id AND ra.student_id = auth.uid()) — the
-- self-comparison ra.resource_id = ra.id never correlates to the outer resources row,
-- so the EXISTS subquery matched resource_assignments rows where resource_id = id (own PK)
-- rather than resource_id = resources.id.

drop policy if exists "resources_student_via_assignment" on public.resources;

create policy "resources_student_via_assignment"
  on public.resources
  for select
  to authenticated
  using (
    (created_by_teacher_id is not null)
    and exists (
      select 1 from public.resource_assignments ra
      where ra.resource_id = resources.id
        and ra.student_id = (select auth.uid())
    )
  );
