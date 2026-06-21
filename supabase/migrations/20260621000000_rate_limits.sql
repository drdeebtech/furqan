-- 20260621000000_rate_limits.sql
--
-- Generic fixed-window rate limiter (audit follow-up).
--
-- Backs per-identifier throttling without a new external dependency. The first
-- consumer is POST /api/guardian/add-child, which limits per authenticated
-- guardian (userId) to blunt the email-enumeration/abuse vector. Keyed on the
-- session userId rather than client IP on purpose — the endpoint is auth-gated,
-- so userId is trustworthy and avoids the X-Forwarded-For trusted-proxy pitfall.
--
-- SECURITY DEFINER; the increment function is granted to service_role only
-- (callers use the admin client behind their own auth gate).

create table if not exists public.rate_limits (
  bucket       text        not null,
  identifier   text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (bucket, identifier, window_start)
);

-- RLS on (CLAUDE.md §3: every table). No policy on purpose — only the
-- SECURITY DEFINER function below and service_role (which bypasses RLS) ever
-- touch this table; authenticated/anon get deny-all.
alter table public.rate_limits enable row level security;

-- NOTE: one row accumulates per (bucket, identifier, window). Volume is bounded
-- per active identifier, but a periodic purge of windows older than the longest
-- configured window is a sensible follow-up (pg_cron / scheduled job).

-- Atomically bump the counter for the current fixed window and report whether
-- the caller is still under the limit. Returns true = allowed, false = exceeded.
create or replace function public.check_and_increment_rate_limit(
  p_bucket          text,
  p_identifier      text,
  p_max             integer,
  p_window_seconds  integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count        integer;
begin
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'check_and_increment_rate_limit: window_seconds must be > 0'
      using errcode = '22023';
  end if;

  if p_max is null or p_max < 0 then
    raise exception 'check_and_increment_rate_limit: max must be >= 0'
      using errcode = '22023';
  end if;

  -- Truncate now() down to the start of the current fixed window.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, identifier, window_start, count)
    values (p_bucket, p_identifier, v_window_start, 1)
  on conflict (bucket, identifier, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke all on function public.check_and_increment_rate_limit(text, text, integer, integer) from public;
grant execute on function public.check_and_increment_rate_limit(text, text, integer, integer) to service_role;
