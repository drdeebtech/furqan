# Phase 1 Data Model: Daily.co webhooks

## New table: `daily_webhook_events`

Idempotency log for processed Daily.co webhook events. 7-day retention via the existing `audit-cleanup` cron.

```sql
create table public.daily_webhook_events (
  event_id      text primary key,
  event_type    text not null check (event_type in ('meeting.started', 'meeting.ended')),
  room_name     text,
  session_id    uuid references public.sessions(id) on delete set null,
  payload_json  jsonb not null,
  received_at   timestamptz not null default now()
);

create index daily_webhook_events_received_at_idx
  on public.daily_webhook_events (received_at);

-- RLS: deny-all to client (this table is server-only)
alter table public.daily_webhook_events enable row level security;
-- (no policies → no client access; service-role bypasses RLS)
```

**Notes**:
- `event_id` PK enforces idempotency at the database boundary.
- `session_id` is nullable because unmappable rooms still get logged (we 200 but record the unmappable event for ops visibility).
- `payload_json` retains the raw payload (post-verification) for forensic debugging.
- `received_at` index supports the 7-day cleanup DELETE.

## Modified table: `sessions`

Additive column, no breaking changes.

```sql
alter table public.sessions
  add column room_name text;

create index sessions_room_name_idx
  on public.sessions (room_name)
  where room_name is not null;

-- Backfill from existing room_url values
-- Daily room URLs are https://<subdomain>.daily.co/<room_name>
update public.sessions
set room_name = substring(room_url from '/([^/]+)$')
where room_url is not null and room_name is null;
```

**Notes**:
- Partial index (`where room_name is not null`) keeps the index small for the rows where it matters.
- `room_url` retained for compatibility (existing teacher/student "Join Session" links read from it).

## Modified column: `sessions.actual_duration`

No schema change. Behavior change: now sourced from Daily's `duration / 60` rounded to minutes, instead of the trigger-computed `(ended_at - started_at)`.

## New SQL functions

### `end_session_from_webhook(...)` — critical path

```sql
create or replace function public.end_session_from_webhook(
  p_session_id     uuid,
  p_ended_at       timestamptz,
  p_duration_min   int,
  p_event_id       text,
  p_event_type     text,
  p_room_name      text,
  p_payload_json   jsonb
) returns table (
  booking_id   uuid,
  student_id   uuid,
  teacher_id   uuid,
  is_duplicate boolean,
  is_reconcile boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_event_id   text;
  v_prior_ended_at      timestamptz;
  v_booking_id          uuid;
  v_student_id          uuid;
  v_teacher_id          uuid;
begin
  -- Step 1: idempotency check via PK conflict
  insert into public.daily_webhook_events
    (event_id, event_type, room_name, session_id, payload_json)
  values
    (p_event_id, p_event_type, p_room_name, p_session_id, p_payload_json)
  on conflict (event_id) do nothing
  returning event_id into v_inserted_event_id;

  if v_inserted_event_id is null then
    -- Duplicate: read existing session for return, but do not re-apply.
    select b.id, b.student_id, b.teacher_id
      into v_booking_id, v_student_id, v_teacher_id
    from public.sessions s
    join public.bookings b on b.id = s.booking_id
    where s.id = p_session_id;
    return query select v_booking_id, v_student_id, v_teacher_id, true, false;
    return;
  end if;

  -- Step 2: capture prior state for reconciliation flag
  select s.ended_at into v_prior_ended_at
  from public.sessions s where s.id = p_session_id;

  -- Step 3: update sessions (Daily-canonical)
  update public.sessions
  set ended_at        = p_ended_at,
      actual_duration = p_duration_min
  where id = p_session_id;

  -- Step 4: update bookings status if currently 'confirmed'
  update public.bookings b
  set status = 'completed'
  from public.sessions s
  where s.id = p_session_id
    and b.id = s.booking_id
    and b.status = 'confirmed'
  returning b.id, b.student_id, b.teacher_id
  into v_booking_id, v_student_id, v_teacher_id;

  -- If bookings update didn't match (already completed/cancelled),
  -- fetch via plain join.
  if v_booking_id is null then
    select b.id, b.student_id, b.teacher_id
      into v_booking_id, v_student_id, v_teacher_id
    from public.sessions s
    join public.bookings b on b.id = s.booking_id
    where s.id = p_session_id;
  end if;

  -- Step 5: audit log
  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    null,  -- system actor
    case when v_prior_ended_at is not null
         then 'session.webhook.reconciled'
         else 'session.webhook.ended' end,
    'sessions',
    p_session_id,
    jsonb_build_object(
      'event_id', p_event_id,
      'ended_at', p_ended_at,
      'duration_min', p_duration_min,
      'prior_ended_at', v_prior_ended_at
    )
  );

  return query select v_booking_id, v_student_id, v_teacher_id, false,
                     (v_prior_ended_at is not null);
end;
$$;

grant execute on function public.end_session_from_webhook to service_role;
```

### `start_session_from_webhook(...)` — simpler path

```sql
create or replace function public.start_session_from_webhook(
  p_session_id   uuid,
  p_started_at   timestamptz,
  p_event_id     text,
  p_room_name    text,
  p_payload_json jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_event_id text;
begin
  insert into public.daily_webhook_events
    (event_id, event_type, room_name, session_id, payload_json)
  values
    (p_event_id, 'meeting.started', p_room_name, p_session_id, p_payload_json)
  on conflict (event_id) do nothing
  returning event_id into v_inserted_event_id;

  if v_inserted_event_id is null then
    return false;  -- duplicate
  end if;

  update public.sessions
  set started_at = p_started_at
  where id = p_session_id;

  insert into public.audit_log (actor_id, action, table_name, record_id, metadata)
  values (
    null,
    'session.webhook.started',
    'sessions',
    p_session_id,
    jsonb_build_object('event_id', p_event_id, 'started_at', p_started_at)
  );

  return true;
end;
$$;

grant execute on function public.start_session_from_webhook to service_role;
```

## State transitions

### Before this feature

```
[page-visit] → sessions.started_at SET
[teacher click "End session"] → sessions.ended_at SET, bookings.status='completed'
[never auto-clears] → sessions stay "open" for days → 18,630-min durations
```

### After this feature

```
[Daily meeting.started] → SQL fn → sessions.started_at SET (Daily-canonical)
[Daily meeting.ended] → SQL fn → sessions.ended_at + actual_duration SET, bookings.status='completed'
[teacher click "End session" before webhook] → sessions.ended_at SET (manual);
   later [Daily meeting.ended] → SQL fn → ended_at + actual_duration OVERWRITTEN; audit_log records reconciliation
[teacher click "End session" after webhook] → guard WHERE ended_at IS NULL matches zero rows;
   action returns success without error
```

## Cleanup cron extension

Existing `src/app/api/cron/audit-cleanup/route.ts` extends to:

```sql
delete from public.daily_webhook_events
where received_at < now() - interval '7 days';
```

At 50k DAU × ~5 sessions/week × 2 events/session ≈ 500k events/week. After cleanup, table size stays at ~500k rows (one week's window) — well within Postgres comfort zone, indexed for the room_name + received_at access patterns.
