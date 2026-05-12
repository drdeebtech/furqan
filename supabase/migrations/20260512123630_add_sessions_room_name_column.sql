-- Migration: add sessions.room_name column
-- Enables the Daily.co webhook receiver to look up a session by the
-- room name that Daily fires in every webhook payload (room.name field).
-- The partial UNIQUE index doubles as the lookup index so no extra
-- index is needed on the hot path.

alter table public.sessions
  add column if not exists room_name text;

-- Pre-flight duplicate check before the partial UNIQUE constraint.
-- Daily names are globally unique by construction, but historical rows
-- could share a parsed room_name (legacy bug, manual insert, restored
-- backup). Surfaces the conflict before the constraint fires so the
-- failure message is actionable rather than opaque.
do $$
declare
  v_dup_count int;
  v_dup_list  text;
begin
  -- Backfill first so the check runs against the final state.
  update public.sessions
  set room_name = substring(room_url from '/([^/]+)$')
  where room_url is not null
    and room_name is null;

  select count(*), string_agg(room_name, ', ' order by room_name)
    into v_dup_count, v_dup_list
  from (
    select room_name
    from public.sessions
    where room_name is not null
    group by room_name
    having count(*) > 1
  ) dups;

  if v_dup_count > 0 then
    raise exception
      'Backfill produced % duplicate room_name values: %. '
      'Clean these manually before re-running this migration '
      '(or temporarily skip the UNIQUE index creation below and resolve in a follow-up).',
      v_dup_count, v_dup_list;
  end if;
end$$;

-- Partial UNIQUE — null rows (backfill window, legacy rows without room_url)
-- are excluded. UNIQUE indexes are usable for SELECT planning, so this also
-- serves as the webhook lookup index (no separate CREATE INDEX needed).
create unique index if not exists sessions_room_name_unique_idx
  on public.sessions (room_name)
  where room_name is not null;
