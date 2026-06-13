-- 20260515131639_cap_homework_chain_depth.sql
-- Closes #235.
-- Cap parent_assignment_id chain depth at 10 to prevent infinite re-assignment
-- loops from runaway auto-regen. A student who never completes an assignment
-- would otherwise accumulate unbounded chains.
-- Uses a recursive CTE bounded at max_depth+1 so Postgres stops early.

create or replace function check_homework_chain_depth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  max_depth constant int := 10;
  chain_depth int;
begin
  if new.parent_assignment_id is null then
    return new;
  end if;

  -- Walk the ancestor chain. Stop at max_depth+1 so we only scan what's needed.
  with recursive chain as (
    select id, parent_assignment_id, 1 as depth
    from homework_assignments
    where id = new.parent_assignment_id
    union all
    select h.id, h.parent_assignment_id, c.depth + 1
    from homework_assignments h
    join chain c on h.id = c.parent_assignment_id
    where c.depth < max_depth + 1
  )
  select coalesce(max(depth), 0) into chain_depth from chain;

  if chain_depth >= max_depth then
    raise exception
      'homework chain depth would exceed maximum of %; teacher must review student %',
      max_depth, new.student_id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists check_homework_chain_depth on homework_assignments;

create trigger check_homework_chain_depth
  before insert or update of parent_assignment_id
  on homework_assignments
  for each row
  execute function check_homework_chain_depth();
