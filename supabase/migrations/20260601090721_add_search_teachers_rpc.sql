-- 20260601090721_add_search_teachers_rpc.sql
--
-- Audit follow-up (deferred from #341): the admin teachers page loaded ALL
-- teacher_profiles, resolved emails with a per-teacher getUserById fan-out, and
-- filtered name/email in JS — un-paginated and a fan-out that grows with the
-- teacher count. Move search + pagination + email resolution server-side.
--
-- SECURITY DEFINER (joins auth.users for email) + admin-gated inside the query
-- so it is not a teacher-directory oracle for non-admins. Explicit casts make
-- the output match the declared return types regardless of underlying column
-- types. total_count via window so the page can render pagination in one call.

create or replace function public.search_teachers(
  p_needle text,
  p_limit int,
  p_offset int
)
returns table (
  teacher_id uuid,
  full_name text,
  email text,
  avatar_url text,
  specialties text[],
  hourly_rate numeric,
  rating_avg numeric,
  total_sessions int,
  is_accepting boolean,
  is_archived boolean,
  cv_status text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with matched as (
    select
      tp.teacher_id,
      p.full_name::text          as full_name,
      u.email::text              as email,
      p.avatar_url::text         as avatar_url,
      tp.specialties::text[]     as specialties,
      tp.hourly_rate::numeric    as hourly_rate,
      tp.rating_avg::numeric     as rating_avg,
      tp.total_sessions::int     as total_sessions,
      tp.is_accepting,
      tp.is_archived,
      tp.cv_status::text         as cv_status
    from public.teacher_profiles tp
    join public.profiles p on p.id = tp.teacher_id
    left join auth.users u on u.id = tp.teacher_id
    where (select public.is_admin())
      and (
        p_needle is null
        or p_needle = ''
        or p.full_name ilike '%' || p_needle || '%'
        or u.email     ilike '%' || p_needle || '%'
      )
  )
  select
    m.teacher_id, m.full_name, m.email, m.avatar_url, m.specialties,
    m.hourly_rate, m.rating_avg, m.total_sessions, m.is_accepting,
    m.is_archived, m.cv_status,
    count(*) over() as total_count
  from matched m
  order by m.total_sessions desc nulls last
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

revoke execute on function public.search_teachers(text, int, int) from public, anon;
grant execute on function public.search_teachers(text, int, int) to authenticated, service_role;
