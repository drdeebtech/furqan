-- spec 014 / 012 §2.5: make the RLS helper SECURITY DEFINER so its read of
-- session_participants bypasses that table's RLS, breaking the
-- sessions -> session_participants -> sessions policy recursion (42P17).
create or replace function public.user_is_session_participant(s_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select exists (
    select 1
    from public.session_participants
    where session_id = s_id
      and user_id = auth.uid()
  );
$$;
