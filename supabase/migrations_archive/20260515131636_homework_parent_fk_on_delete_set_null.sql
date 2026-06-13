-- 20260515131636_homework_parent_fk_on_delete_set_null.sql
-- Closes #236.
-- ON DELETE NO ACTION (default) blocks deleting a parent assignment when children exist.
-- Change to SET NULL so deleting a parent orphans children rather than blocking.
-- Teachers can delete original assignments; re-assigned work keeps its history.

alter table homework_assignments
  drop constraint homework_assignments_parent_assignment_id_fkey;

alter table homework_assignments
  add constraint homework_assignments_parent_assignment_id_fkey
    foreign key (parent_assignment_id)
    references homework_assignments(id)
    on delete set null;
