-- Fix: end_session_from_webhook + start_session_from_webhook reference
-- non-existent audit_log columns `actor_id` and `metadata`. The actual
-- columns are `changed_by` and `new_data` (per src/types/supabase.generated.ts
-- and the rest of the codebase's audit_log inserts).
--
-- Symptom: every Daily.co session start/end webhook call hits this insert
-- and raises SQLSTATE 42703 "column does not exist". Detected via
-- `supabase db lint --linked` on 2026-05-15.
--
-- Fix: recreate both functions with the same body, only the audit_log
-- inserts updated. SECURITY DEFINER + service_role grant preserved.

create or replace function public.end_session_from_webhook(
  p_session_id       uuid,
  p_ended_at         timestamptz,
  p_duration_min     int,
  p_duration_seconds int,
  p_event_id         text,
  p_event_type       text,
  p_room_name        text,
  p_payload_json     jsonb
) returns table (
  booking_id        uuid,
  student_id        uuid,
  teacher_id        uuid,
  is_duplicate      boolean,
  is_reconcile      boolean,
  status_outcome    text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted_event_id    text;
  v_prior_ended_at       timestamptz;
  v_prior_started_at     timestamptz;
  v_prior_booking_status text;
  v_started_at_fill      timestamptz;
  v_booking_id           uuid;
  v_student_id           uuid;
  v_teacher_id           uuid;
  v_status_outcome       text;
  v_audit_action         text;
  c_misclick_threshold_seconds constant int := 300;
begin
  insert into public.daily_webhook_events
    (event_id, event_type, room_name, session_id, payload_json)
  values
    (p_event_id, p_event_type, p_room_name, p_session_id, p_payload_json)
  on conflict (event_id) do nothing
  returning event_id into v_inserted_event_id;

  if v_inserted_event_id is null then
    select b.id, b.student_id, b.teacher_id
      into v_booking_id, v_student_id, v_teacher_id
    from public.sessions s
    join public.bookings b on b.id = s.booking_id
    where s.id = p_session_id;
    return query select v_booking_id, v_student_id, v_teacher_id, true, false, 'duplicate'::text;
    return;
  end if;

  select s.ended_at, s.started_at, b.status
    into v_prior_ended_at, v_prior_started_at, v_prior_booking_status
  from public.sessions s
  join public.bookings b on b.id = s.booking_id
  where s.id = p_session_id;

  if v_prior_started_at is null then
    v_started_at_fill := p_ended_at - make_interval(secs => p_duration_seconds);
  else
    v_started_at_fill := v_prior_started_at;
  end if;

  update public.sessions
  set ended_at        = p_ended_at,
      actual_duration = p_duration_min,
      started_at      = v_started_at_fill
  where id = p_session_id;

  if v_prior_booking_status = 'confirmed' then
    if p_duration_seconds >= c_misclick_threshold_seconds then
      update public.bookings b
      set status = 'completed'
      from public.sessions s
      where s.id = p_session_id and b.id = s.booking_id
      returning b.id, b.student_id, b.teacher_id
      into v_booking_id, v_student_id, v_teacher_id;
      v_status_outcome := 'completed';
      v_audit_action   := case when v_prior_ended_at is not null
                              then 'session.webhook.reconciled'
                              else 'session.webhook.ended' end;
    else
      update public.bookings b
      set status = 'no_show'
      from public.sessions s
      where s.id = p_session_id and b.id = s.booking_id
      returning b.id, b.student_id, b.teacher_id
      into v_booking_id, v_student_id, v_teacher_id;
      v_status_outcome := 'no_show';
      v_audit_action   := 'session.webhook.misclick_filtered';
    end if;
  else
    select b.id, b.student_id, b.teacher_id
      into v_booking_id, v_student_id, v_teacher_id
    from public.sessions s
    join public.bookings b on b.id = s.booking_id
    where s.id = p_session_id;
    v_status_outcome := 'preserved';
    v_audit_action   := case v_prior_booking_status
                          when 'cancelled' then 'session.webhook.ended_on_cancelled'
                          when 'no_show'   then 'session.webhook.ended_on_cancelled'
                          else (case when v_prior_ended_at is not null
                                     then 'session.webhook.reconciled'
                                     else 'session.webhook.ended' end)
                        end;
  end if;

  -- FIXED: changed_by (not actor_id), new_data (not metadata)
  insert into public.audit_log (changed_by, action, table_name, record_id, new_data)
  values (
    null,
    v_audit_action,
    'sessions',
    p_session_id,
    jsonb_build_object(
      'event_id',              p_event_id,
      'ended_at',              p_ended_at,
      'duration_min',          p_duration_min,
      'duration_seconds',      p_duration_seconds,
      'prior_ended_at',        v_prior_ended_at,
      'prior_started_at',      v_prior_started_at,
      'prior_booking_status',  v_prior_booking_status,
      'started_at_filled',     (v_prior_started_at is null),
      'status_outcome',        v_status_outcome
    )
  );

  return query select v_booking_id, v_student_id, v_teacher_id, false,
                     (v_prior_ended_at is not null), v_status_outcome;
end;
$$;

grant execute on function public.end_session_from_webhook to service_role;

-- ── start_session_from_webhook ───────────────────────────────────────────────

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
    return false;
  end if;

  update public.sessions
  set started_at = p_started_at
  where id = p_session_id;

  -- FIXED: changed_by (not actor_id), new_data (not metadata)
  insert into public.audit_log (changed_by, action, table_name, record_id, new_data)
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
