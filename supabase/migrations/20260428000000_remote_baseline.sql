


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."attendance_status" AS ENUM (
    'registered',
    'attended',
    'absent',
    'late',
    'left_early'
);


ALTER TYPE "public"."attendance_status" OWNER TO "postgres";


CREATE TYPE "public"."booking_cancel_reason_code" AS ENUM (
    'teacher_unavailable',
    'student_request',
    'schedule_conflict',
    'technical_issue',
    'admin_override',
    'package_exhausted',
    'other'
);


ALTER TYPE "public"."booking_cancel_reason_code" OWNER TO "postgres";


CREATE TYPE "public"."booking_status" AS ENUM (
    'pending',
    'confirmed',
    'completed',
    'cancelled',
    'no_show'
);


ALTER TYPE "public"."booking_status" OWNER TO "postgres";


CREATE TYPE "public"."cv_status" AS ENUM (
    'draft',
    'pending_review',
    'approved',
    'rejected'
);


ALTER TYPE "public"."cv_status" OWNER TO "postgres";


CREATE TYPE "public"."evaluation_type" AS ENUM (
    'weekly',
    'biweekly',
    'monthly',
    'quarterly'
);


ALTER TYPE "public"."evaluation_type" OWNER TO "postgres";


CREATE TYPE "public"."gender_type" AS ENUM (
    'male',
    'female'
);


ALTER TYPE "public"."gender_type" OWNER TO "postgres";


CREATE TYPE "public"."homework_status" AS ENUM (
    'assigned',
    'student_ready',
    'completed_excellent',
    'completed_good',
    'completed_needs_work',
    'completed_not_done'
);


ALTER TYPE "public"."homework_status" OWNER TO "postgres";


CREATE TYPE "public"."homework_type" AS ENUM (
    'hifz',
    'muraja',
    'recitation',
    'tajweed',
    'writing',
    'listening'
);


ALTER TYPE "public"."homework_type" OWNER TO "postgres";


CREATE TYPE "public"."msg_type" AS ENUM (
    'text',
    'audio',
    'file'
);


ALTER TYPE "public"."msg_type" OWNER TO "postgres";


CREATE TYPE "public"."notif_type" AS ENUM (
    'booking',
    'payment',
    'message',
    'reminder',
    'system',
    'homework',
    'course'
);


ALTER TYPE "public"."notif_type" OWNER TO "postgres";


CREATE TYPE "public"."participant_role" AS ENUM (
    'teacher',
    'student'
);


ALTER TYPE "public"."participant_role" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'pending',
    'succeeded',
    'failed',
    'refunded'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."report_type" AS ENUM (
    'session_summary',
    'evaluation',
    'custom',
    'missed_session',
    'schedule_change'
);


ALTER TYPE "public"."report_type" OWNER TO "postgres";


CREATE TYPE "public"."session_mode" AS ENUM (
    'private',
    'halaqa',
    'lecture'
);


ALTER TYPE "public"."session_mode" OWNER TO "postgres";


CREATE TYPE "public"."session_type" AS ENUM (
    'hifz',
    'muraja',
    'tajweed',
    'tilawa',
    'qiraat',
    'tafsir',
    'combined',
    'other'
);


ALTER TYPE "public"."session_type" OWNER TO "postgres";


CREATE TYPE "public"."student_level" AS ENUM (
    'beginner',
    'intermediate',
    'advanced'
);


ALTER TYPE "public"."student_level" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'student',
    'teacher',
    'admin',
    'moderator'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ensure_teacher_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.role = 'teacher'::user_role
     and not exists (select 1 from public.teacher_profiles where teacher_id = new.id)
  then
    insert into public.teacher_profiles (
      teacher_id, specialties, hourly_rate, languages,
      recitation_standards, cv_status, cv_submitted_at,
      is_accepting, is_archived
    ) values (
      new.id, '{}', 20, '{ar}', '{hafs}',
      'approved'::cv_status, now(),
      true, false
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."ensure_teacher_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "private"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'admin'
      AND deleted_at IS NULL
      AND is_active = true
  );
$$;


ALTER FUNCTION "private"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_admin_or_mod"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists(
    select 1 from public.profiles
     where id = (select auth.uid())
       and role = 'admin'::public.user_role
       and deleted_at is null
       and is_active = true
  )
$$;


ALTER FUNCTION "private"."is_admin_or_mod"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_moderator"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$ select false $$;


ALTER FUNCTION "private"."is_moderator"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."profile_is_visible"("p_target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    -- self
    p_target = (select auth.uid())
    -- admin sees everyone
    or (select private.is_admin())
    -- teacher <-> student via a non-deleted booking (either direction)
    or exists (
      select 1
      from public.bookings b
      where b.deleted_at is null
        and (
          (b.teacher_id = (select auth.uid()) and b.student_id = p_target)
          or (b.student_id = (select auth.uid()) and b.teacher_id = p_target)
        )
    )
    -- teacher <-> student via a course enrollment (either direction)
    or exists (
      select 1
      from public.course_enrollments ce
      join public.courses c on c.id = ce.course_id
      where (c.teacher_id = (select auth.uid()) and ce.student_id = p_target)
         or (ce.student_id = (select auth.uid()) and c.teacher_id = p_target)
    );
$$;


ALTER FUNCTION "private"."profile_is_visible"("p_target" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "private"."profile_is_visible"("p_target" "uuid") IS 'RLS helper for profiles SELECT: true when the target row is the caller, the caller is admin, or the two share a teacher<->student relationship (bookings or course enrollment). SECURITY DEFINER to read the relationship tables without their RLS. See audit HIGH-1.';



CREATE OR REPLACE FUNCTION "private"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "private"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_teacher_archive_with_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if old.deleted_at is null and new.deleted_at is not null and new.role = 'teacher'::user_role then
    update public.teacher_profiles
       set is_archived = true,
           archived_at = new.deleted_at
     where teacher_id = new.id;
  end if;
  if old.deleted_at is not null and new.deleted_at is null and new.role = 'teacher'::user_role then
    update public.teacher_profiles
       set is_archived = false,
           archived_at = null
     where teacher_id = new.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_teacher_archive_with_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."teacher_has_booked_student"("p_teacher" "uuid", "p_student" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private'
    AS $$
  select exists (
    select 1 from public.bookings
    where teacher_id = p_teacher
      and student_id = p_student
  );
$$;


ALTER FUNCTION "private"."teacher_has_booked_student"("p_teacher" "uuid", "p_student" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_log_redact_pii_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.old_data := public.redact_pii(new.old_data);
  new.new_data := public.redact_pii(new.new_data);
  return new;
end;
$$;


ALTER FUNCTION "public"."audit_log_redact_pii_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calc_actual_duration"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  raw_minutes INTEGER;
  planned_minutes INTEGER;
BEGIN
  IF NEW.started_at IS NOT NULL AND NEW.ended_at IS NOT NULL THEN
    raw_minutes := ROUND(EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) / 60);

    SELECT duration_min INTO planned_minutes
      FROM bookings WHERE id = NEW.booking_id;

    -- Cap at 2× planned. A 30-min slot can legitimately run to ~60min; beyond
    -- that, the data is almost certainly corrupt (someone left the room open).
    -- Surfacing NULL is more honest than a fabricated number.
    IF planned_minutes IS NOT NULL AND raw_minutes > planned_minutes * 2 THEN
      NEW.actual_duration = NULL;
    ELSE
      NEW.actual_duration = raw_minutes;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calc_actual_duration"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_homework_chain_depth"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."check_homework_chain_depth"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_review"("p_schedule_id" "uuid", "p_easiness" real, "p_interval_days" integer) RETURNS TABLE("next_review_at" timestamp with time zone, "easiness_factor" real, "interval_days" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  -- SECURITY INVOKER + the student RLS update policy (student_id = auth.uid())
  -- gate this: a row the caller doesn't own updates 0 rows → not found → raise.
  -- next_review_at is stamped off the DB clock (now()), never passed in, to keep
  -- the schedule clock authoritative and free of client skew.
  return query
    update student_review_schedule
      set easiness_factor  = p_easiness,
          interval_days    = p_interval_days,
          next_review_at   = now() + make_interval(days => p_interval_days),
          last_reviewed_at = now(),
          batch_for_date   = null
      where id = p_schedule_id
      returning student_review_schedule.next_review_at,
                student_review_schedule.easiness_factor,
                student_review_schedule.interval_days;
  if not found then
    raise exception 'schedule row not found' using errcode = 'P0002';
  end if;
end; $$;


ALTER FUNCTION "public"."complete_review"("p_schedule_id" "uuid", "p_easiness" real, "p_interval_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_murajaah_batch_for_date"("p_date" "date") RETURNS TABLE("students_processed" integer, "rows_scheduled" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_initial_interval int;
  v_initial_ef real;
begin
  select value::int  into v_initial_interval from platform_settings where key = 'sm2_initial_interval_days';
  select value::real into v_initial_ef       from platform_settings where key = 'sm2_easiness_factor';
  v_initial_interval := coalesce(v_initial_interval, 1);
  v_initial_ef := coalesce(v_initial_ef, 2.5);

  -- Seed a schedule row for each memorised (progress_type='new') item not yet scheduled.
  insert into student_review_schedule (student_id, progress_id, next_review_at, easiness_factor, interval_days)
  select sp.student_id, sp.id, now() + make_interval(days => v_initial_interval), v_initial_ef, v_initial_interval
  from student_progress sp
  where sp.progress_type = 'new'
    and not exists (select 1 from student_review_schedule s where s.student_id = sp.student_id and s.progress_id = sp.id);

  -- Set batch_for_date on up to 15 due rows per student within the 7-day fresh
  -- window, oldest-overdue-first (FR-011: backlog beyond 7 days does NOT flood
  -- the card — it routes to the teacher reteach queue, US2).
  -- Range predicate on the raw timestamptz column (NOT next_review_at::date,
  -- which is non-SARGable and would force a full scan of a 10M-row table at
  -- 50k DAU). [(p_date - 7) 00:00, (p_date + 1) 00:00) == dates p_date-7..p_date
  -- inclusive, and uses the (student_id, next_review_at) index.
  with ranked as (
    select id, row_number() over (partition by student_id order by next_review_at asc) as rn
    from student_review_schedule
    where next_review_at >= (p_date - 7)::timestamptz
      and next_review_at <  (p_date + 1)::timestamptz
      and (batch_for_date is null or batch_for_date <> p_date)
  )
  update student_review_schedule s
    set batch_for_date = p_date
  from ranked where s.id = ranked.id and ranked.rn <= 15;

  return query
    select count(distinct student_id)::int, count(*)::int
    from student_review_schedule where batch_for_date = p_date;
end; $$;


ALTER FUNCTION "public"."compute_murajaah_batch_for_date"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_booking_with_session"("p_booking_id" "uuid", "p_room_url" "text", "p_room_name" "text", "p_expires_at" timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_session_id uuid;
  v_updated_count int;
begin
  -- 1. Confirm the booking — succeeds only if currently in 'pending' status.
  --    teacher_confirmed / teacher_confirmed_at match the V9 flow the route
  --    adapter set inline before this function existed.
  update public.bookings
  set
    status = 'confirmed',
    teacher_confirmed = true,
    teacher_confirmed_at = now()
  where id = p_booking_id
    and status = 'pending';

  get diagnostics v_updated_count = row_count;

  if v_updated_count = 0 then
    -- Either the booking doesn't exist or is not in 'pending' state.
    -- The orchestrator pre-reads the booking before calling this, so a
    -- 'booking_not_pending' raise here means a race lost (someone else
    -- transitioned the booking between the orchestrator's pre-read and
    -- this UPDATE). The orchestrator translates this into
    -- BookingAlreadyConfirmedError.
    raise exception 'booking_not_pending'
      using errcode = 'P0001',
            detail = 'booking ' || p_booking_id || ' is not in pending state';
  end if;

  -- 2. Insert the sessions row in the same transaction. If this fails
  --    (e.g., FK violation, duplicate booking_id, NOT NULL on a column
  --    we forgot), the bookings UPDATE above rolls back — no orphaned
  --    status='confirmed' booking with a missing sessions row.
  insert into public.sessions (
    booking_id,
    room_name,
    room_url,
    expires_at,
    created_via
  )
  values (
    p_booking_id,
    p_room_name,
    p_room_url,
    p_expires_at,
    'auto'
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;


ALTER FUNCTION "public"."confirm_booking_with_session"("p_booking_id" "uuid", "p_room_url" "text", "p_room_name" "text", "p_expires_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_booking_with_session"("p_booking_id" "uuid", "p_room_url" "text", "p_room_name" "text", "p_expires_at" timestamp with time zone) IS 'Atomic booking confirmation. UPDATE bookings.status=''confirmed'' + INSERT sessions in one transaction. Raises ''booking_not_pending'' (errcode P0001) when the booking is not currently pending. Called by src/lib/domains/booking/orchestrate.ts confirmBooking(). See ADR-0004.';



CREATE OR REPLACE FUNCTION "public"."deduct_package_session"("p_package_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update student_packages
  set sessions_used = sessions_used + 1
  where id = p_package_id
    and status = 'active'
    and sessions_used < sessions_total
    and (expires_at is null or expires_at > now())
  returning true;
$$;


ALTER FUNCTION "public"."deduct_package_session"("p_package_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_package_session_mode"("p_package_id" "uuid", "p_mode" "text") RETURNS TABLE("deducted" boolean, "used_legacy" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with allowance as (
    select
      sp.id,
      coalesce(
        nullif((p.session_mode_allowances ->> p_mode)::int, 0),
        case when p_mode = 'private' then p.session_count else 0 end
      )                                                                    as mode_allowance,
      coalesce((sp.session_mode_used ->> p_mode)::int, 0)                 as mode_used,
      -- is_legacy = private mode falling back to session_count because the
      -- per-mode JSONB allowance is absent or zero (old package definition).
      (
        nullif((p.session_mode_allowances ->> p_mode)::int, 0) is null
        and p_mode = 'private'
      )                                                                    as is_legacy
    from student_packages sp
    join packages p on p.id = sp.package_id
    where sp.id = p_package_id
      and sp.status = 'active'
      and sp.sessions_used < sp.sessions_total
      and (sp.expires_at is null or sp.expires_at > now())
  ),
  updated as (
    update student_packages
    set
      sessions_used      = sessions_used + 1,
      session_mode_used  = jsonb_set(
        session_mode_used,
        array[p_mode],
        to_jsonb(coalesce((session_mode_used ->> p_mode)::int, 0) + 1)
      )
    from allowance a
    where student_packages.id = a.id
      and a.mode_used < a.mode_allowance
    returning a.is_legacy
  )
  select
    exists(select 1 from updated)                        as deducted,
    coalesce((select is_legacy from updated limit 1), false) as used_legacy;
$$;


ALTER FUNCTION "public"."deduct_package_session_mode"("p_package_id" "uuid", "p_mode" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."deduct_package_session_mode"("p_package_id" "uuid", "p_mode" "text") IS 'Atomic mode-aware decrement. Returns (deducted, used_legacy).
   used_legacy=true when a private booking fell back to packages.session_count
   because session_mode_allowances was zero (legacy package). Stage 5 booking
   flow should surface a prompt when used_legacy is true so admin can migrate
   the package to explicit mode allowances.';



CREATE OR REPLACE FUNCTION "public"."deduct_student_credit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if NEW.status = 'confirmed' and OLD.status = 'pending' then
    with target as (
      select id from student_credits
      where student_id = NEW.student_id
        and (teacher_id is null or teacher_id = NEW.teacher_id)
        and used < total
        and (expires_at is null or expires_at > now())
      order by expires_at asc nulls last
      limit 1
      for update skip locked
    )
    update student_credits
    set used = used + 1
    where id = (select id from target);
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."deduct_student_credit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deduct_student_package"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_pkg uuid;
begin
  if new.status = 'confirmed' and old.status = 'pending' then
    -- Only the 1:1 path reaches here (group/class insert as 'confirmed' and
    -- deduct via the deduct_package_session RPC). If student_package_id is
    -- already set, the charge was handled elsewhere — do nothing (no double
    -- deduct). Guard retained from #346.
    if new.student_package_id is not null then
      return new;
    end if;

    -- Pick the soonest-expiry active package with credit remaining. FOR UPDATE
    -- SKIP LOCKED keeps concurrent confirms from racing onto the same package.
    select id into v_pkg
    from student_packages
    where student_id = new.student_id
      and status = 'active'
      and sessions_used < sessions_total
      and (expires_at is null or expires_at > now())
    order by expires_at asc nulls last, purchased_at asc
    limit 1
    for update skip locked;

    if v_pkg is not null then
      -- Delegate the decrement to the canonical kernel (one mutation rule for
      -- every debit path). Returns true when a row was charged; the row is
      -- already locked above and matches the kernel's guard, so this succeeds.
      if deduct_package_session(v_pkg) then
        -- Stamp the charged package onto the booking so restore credits the
        -- SAME package (audit H17). Touches student_package_id only — not
        -- status — so this UPDATE does not re-fire the status triggers.
        update bookings
        set student_package_id = v_pkg
        where id = new.id;
      end if;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."deduct_student_package"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."end_session_from_webhook"("p_session_id" "uuid", "p_ended_at" timestamp with time zone, "p_duration_min" integer, "p_duration_seconds" integer, "p_event_id" "text", "p_event_type" "text", "p_room_name" "text", "p_payload_json" "jsonb") RETURNS TABLE("booking_id" "uuid", "student_id" "uuid", "teacher_id" "uuid", "is_duplicate" boolean, "is_reconcile" boolean, "status_outcome" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."end_session_from_webhook"("p_session_id" "uuid", "p_ended_at" timestamp with time zone, "p_duration_min" integer, "p_duration_seconds" integer, "p_event_id" "text", "p_event_type" "text", "p_room_name" "text", "p_payload_json" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."end_session_with_booking"("p_session_id" "uuid", "p_actual_duration" integer) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_booking_id uuid;
  v_ended_at timestamptz := now();
  v_count int;
begin
  -- 1. End the session — succeeds only if not already ended. Capture the
  --    booking id from the same row so we don't need a second read.
  update public.sessions
  set ended_at = v_ended_at,
      actual_duration = p_actual_duration
  where id = p_session_id
    and ended_at is null
  returning booking_id into v_booking_id;

  get diagnostics v_count = row_count;

  if v_count = 0 then
    -- Already ended (webhook / double-fire) or the session does not exist.
    -- The orchestrator pre-reads ended_at, so reaching here means a race was
    -- lost; it maps this to an idempotent already-ended result.
    raise exception 'session_already_ended'
      using errcode = 'P0001',
            detail = 'session ' || p_session_id || ' is already ended or does not exist';
  end if;

  -- sessions.booking_id is nullable. A session with no booking has nothing to
  -- complete — failing here keeps the "session + booking in one transaction"
  -- guarantee honest (the session UPDATE above rolls back too) rather than
  -- silently ending the session while completing zero booking rows.
  if v_booking_id is null then
    raise exception 'session_without_booking'
      using errcode = 'P0001',
            detail = 'session ' || p_session_id || ' has no booking_id to complete';
  end if;

  -- 2. Complete the booking. Guarded so a re-completion is a no-op rather than
  --    re-firing the confirmed->completed work (e.g. t_inc_teacher_sessions).
  update public.bookings
  set status = 'completed'
  where id = v_booking_id
    and status <> 'completed';

  return v_ended_at;
end;
$$;


ALTER FUNCTION "public"."end_session_with_booking"("p_session_id" "uuid", "p_actual_duration" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_homework_update_rules"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- Admins can force any transition / correct graded rows.
  if is_admin() then
    return new;
  end if;

  -- Completed homework is immutable to non-admins — blocks ANY column change
  -- (former guard_completed_homework_immutable, #234).
  if old.status in (
    'completed_excellent',
    'completed_good',
    'completed_needs_work',
    'completed_not_done'
  ) then
    raise exception
      'homework % is completed and immutable; use admin override to correct',
      old.id
      using errcode = 'P0001';
  end if;

  -- Validate status transitions, only when status actually changes
  -- (former validate_homework_status, #233).
  if new.status is distinct from old.status then
    if old.status = 'assigned' and new.status not in ('assigned', 'student_ready') then
      raise exception
        'invalid homework status transition: % → %',
        old.status, new.status
        using errcode = 'P0001';
    end if;

    if old.status = 'student_ready' and new.status not in (
      'student_ready',
      'completed_excellent',
      'completed_good',
      'completed_needs_work',
      'completed_not_done'
    ) then
      raise exception
        'invalid homework status transition: % → %',
        old.status, new.status
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_homework_update_rules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_forum_replies_after_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  update public.forum_threads
    set reply_count = greatest(0, reply_count - 1)
    where id = old.thread_id;
  return old;
end;
$$;


ALTER FUNCTION "public"."fn_forum_replies_after_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fn_forum_replies_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  update public.forum_threads
    set reply_count = reply_count + 1,
        last_reply_at = new.created_at
    where id = new.thread_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."fn_forum_replies_after_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gen_invoice_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.invoice_number := 'FURQAN-' || to_char(NOW(), 'YYYY') || '-' ||
    LPAD(nextval('invoice_seq')::text, 5, '0');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."gen_invoice_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gen_room_name"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.room_name IS NULL OR NEW.room_name = '' THEN
    NEW.room_name := 'furqan-' || REPLACE(uuid_generate_v4()::text, '-', '');
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."gen_room_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_teacher_overdue_eval_count"("p_teacher_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT COUNT(*)::integer
  FROM public.bookings b
  WHERE b.teacher_id = p_teacher_id
    AND b.status = 'completed'
    AND b.scheduled_at < (NOW() - INTERVAL '7 days')
    AND NOT EXISTS (
      SELECT 1
      FROM public.session_evaluations e
      WHERE e.teacher_id = p_teacher_id
        AND e.student_id = b.student_id
        AND e.created_at > b.scheduled_at
    );
$$;


ALTER FUNCTION "public"."get_teacher_overdue_eval_count"("p_teacher_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_teacher_overdue_eval_count"("p_teacher_id" "uuid") IS 'Returns count of completed bookings older than 7 days that have no follow-up evaluation. Used by /teacher/dashboard action queue and the CONFIRM-booking gate (dashboard/actions.ts) to nudge teachers toward evaluation discipline before the gate hardens 2026-05-19.';



CREATE OR REPLACE FUNCTION "public"."get_user_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  -- Guard null/blank input explicitly (CodeRabbit); returns NULL, which the
  -- caller treats as "student not found".
  select id from auth.users
  where p_email is not null
    and length(btrim(p_email)) > 0
    and lower(email) = lower(p_email)
  limit 1;
$$;


ALTER FUNCTION "public"."get_user_id_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_session"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  b_status booking_status;
BEGIN
  SELECT status INTO b_status FROM bookings WHERE id = NEW.booking_id;
  IF b_status NOT IN ('confirmed', 'completed') THEN
    RAISE EXCEPTION 'Cannot create session for booking with status: %', b_status;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."inc_teacher_sessions"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE teacher_profiles SET total_sessions = total_sessions + 1
  WHERE teacher_id = NEW.teacher_id;
  UPDATE payments
  SET revenue_recognized = revenue_recognized + (NEW.rate_snapshot * (NEW.duration_min / 60.0))
  WHERE booking_id = NEW.id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."inc_teacher_sessions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select private.is_admin()
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_or_mod"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select private.is_admin_or_mod()
$$;


ALTER FUNCTION "public"."is_admin_or_mod"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_moderator"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select private.is_moderator()
$$;


ALTER FUNCTION "public"."is_moderator"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_confirmed_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.status IN ('confirmed', 'completed') AND NOT is_admin() THEN
    IF OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at THEN
      RAISE EXCEPTION 'scheduled_at is locked after confirmation';
    END IF;
    IF OLD.duration_min IS DISTINCT FROM NEW.duration_min THEN
      RAISE EXCEPTION 'duration_min is locked after confirmation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."lock_confirmed_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_rate_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.rate_snapshot IS NOT NULL
     AND OLD.rate_snapshot IS DISTINCT FROM NEW.rate_snapshot
     AND NOT is_admin()
  THEN
    RAISE EXCEPTION 'rate_snapshot is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."lock_rate_snapshot"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_refund_policy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.refund_policy_id IS NOT NULL
     AND OLD.refund_policy_id IS DISTINCT FROM NEW.refund_policy_id
     AND NOT is_admin()
  THEN
    RAISE EXCEPTION 'refund_policy_id is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."lock_refund_policy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."murajaah_due_student_ids"("p_active_since" timestamp with time zone, "p_today_start" timestamp with time zone) RETURNS TABLE("student_id" "uuid")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select distinct sp.student_id
  from public.student_progress sp
  where sp.created_at >= p_active_since
    and not exists (
      select 1
      from public.study_log sl
      where sl.student_id = sp.student_id
        and sl.started_at >= p_today_start
    );
$$;


ALTER FUNCTION "public"."murajaah_due_student_ids"("p_active_since" timestamp with time zone, "p_today_start" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profiles_role_counts"() RETURNS TABLE("role" "text", "n" bigint)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select p.role::text, count(*)::bigint
  from public.profiles p
  where (select public.is_admin())   -- non-admins get zero rows
  group by p.role;
$$;


ALTER FUNCTION "public"."profiles_role_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recompute_course_review_aggregates"("p_course_id" "uuid") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  update public.courses
  set
    rating_avg_cached = (
      select round(avg(stars)::numeric, 2)
      from public.course_reviews
      where course_id = p_course_id and status = 'published'
    ),
    rating_count_cached = (
      select count(*)
      from public.course_reviews
      where course_id = p_course_id and status = 'published'
    )
  where id = p_course_id;
$$;


ALTER FUNCTION "public"."recompute_course_review_aggregates"("p_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_student_progress"("p_booking_id" "uuid", "p_progress_type" "text", "p_surah_from" integer, "p_ayah_from" integer, "p_surah_to" integer, "p_ayah_to" integer, "p_pages_reviewed" integer, "p_quality_rating" integer, "p_level" "text", "p_teacher_notes" "text", "p_errors" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_student uuid;
  v_teacher uuid;
  v_progress_id uuid;
begin
  -- Derive parties from the booking (caller already authorized at the adapter).
  select student_id, teacher_id into v_student, v_teacher
  from bookings where id = p_booking_id;
  if v_student is null then
    raise exception 'booking_not_found' using errcode = 'P0001';
  end if;

  insert into student_progress (
    student_id, teacher_id, booking_id, progress_type,
    surah_from, ayah_from, surah_to, ayah_to,
    pages_reviewed, quality_rating, level, teacher_notes
  )
  values (
    v_student, v_teacher, p_booking_id, coalesce(p_progress_type, 'new'),
    p_surah_from, p_ayah_from, p_surah_to, p_ayah_to,
    p_pages_reviewed, p_quality_rating, coalesce(p_level, 'beginner')::student_level, p_teacher_notes
  )
  on conflict (student_id, booking_id) do update set
    progress_type  = excluded.progress_type,
    surah_from     = excluded.surah_from,
    ayah_from      = excluded.ayah_from,
    surah_to       = excluded.surah_to,
    ayah_to        = excluded.ayah_to,
    pages_reviewed = excluded.pages_reviewed,
    quality_rating = excluded.quality_rating,
    level          = excluded.level,
    teacher_notes  = excluded.teacher_notes
  returning id into v_progress_id;
  -- t_validate_student_progress_range fires here; an impossible range raises 23514.

  -- Replace this booking's errors. When the teacher supplies real errors, clear
  -- ALL prior rows for this progress — including any "no errors observed"
  -- sentinel, which would otherwise coexist with real errors and leave a
  -- contradictory state. When no errors are supplied (p_errors null/empty),
  -- leave existing rows untouched (preserves a prior sentinel set via
  -- markNoErrorsObserved).
  if p_errors is not null and jsonb_typeof(p_errors) = 'array' and jsonb_array_length(p_errors) > 0 then
    delete from recitation_errors where progress_id = v_progress_id;
    insert into recitation_errors (progress_id, surah_num, ayah_num, error_type, note)
    select
      v_progress_id,
      (e->>'surah_num')::smallint,
      (e->>'ayah_num')::integer,
      e->>'error_type',
      nullif(e->>'note', '')
    from jsonb_array_elements(p_errors) e;
  end if;

  return v_progress_id;
end;
$$;


ALTER FUNCTION "public"."record_student_progress"("p_booking_id" "uuid", "p_progress_type" "text", "p_surah_from" integer, "p_ayah_from" integer, "p_surah_to" integer, "p_ayah_to" integer, "p_pages_reviewed" integer, "p_quality_rating" integer, "p_level" "text", "p_teacher_notes" "text", "p_errors" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."redact_pii"("payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  redacted jsonb := payload;
  pii_keys text[] := array[
    'email', 'phone', 'parent_email', 'parent_phone', 'whatsapp',
    'date_of_birth', 'avatar_url'
  ];
  k text;
begin
  if payload is null then
    return null;
  end if;
  foreach k in array pii_keys loop
    if redacted ? k then
      redacted := jsonb_set(redacted, array[k], to_jsonb('***REDACTED***'::text));
    end if;
  end loop;
  return redacted;
end;
$$;


ALTER FUNCTION "public"."redact_pii"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refund_package_session"("p_package_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update student_packages
  set sessions_used = sessions_used - 1
  where id = p_package_id
    and sessions_used > 0;
  return found;
end;
$$;


ALTER FUNCTION "public"."refund_package_session"("p_package_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_student_credit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if NEW.status = 'cancelled' and OLD.status = 'confirmed' then
    with target as (
      select id from student_credits
      where student_id = NEW.student_id
        and (teacher_id is null or teacher_id = NEW.teacher_id)
        and used > 0
      order by expires_at asc nulls last
      limit 1
      for update skip locked
    )
    update student_credits
    set used = greatest(used - 1, 0)
    where id = (select id from target);
  end if;
  return NEW;
end;
$$;


ALTER FUNCTION "public"."restore_student_credit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_student_package"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'cancelled' and old.status = 'confirmed' then
    -- Credit ONLY the exact package that was charged (stamped on deduct by
    -- #346, or set at insert for group/class). A NULL stamp means no package
    -- was debited for this booking, so there is nothing to restore -- do not
    -- re-derive a package (that would be a free session credit, #363).
    if new.student_package_id is not null then
      update student_packages
      set sessions_used = greatest(sessions_used - 1, 0)
      where id = new.student_package_id
        and sessions_used > 0;   -- clamp guard: never restore below 0
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."restore_student_package"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."session_evaluations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "evaluation_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "evaluation_type" "public"."evaluation_type" DEFAULT 'monthly'::"public"."evaluation_type" NOT NULL,
    "hifz_score" integer,
    "tajweed_score" integer,
    "fluency_score" integer,
    "attendance_score" integer,
    "overall_score" integer,
    "strengths" "text",
    "areas_for_improvement" "text",
    "teacher_comments" "text",
    "next_goals" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_evaluations_attendance_score_check" CHECK ((("attendance_score" >= 1) AND ("attendance_score" <= 10))),
    CONSTRAINT "session_evaluations_fluency_score_check" CHECK ((("fluency_score" >= 1) AND ("fluency_score" <= 10))),
    CONSTRAINT "session_evaluations_hifz_score_check" CHECK ((("hifz_score" >= 1) AND ("hifz_score" <= 10))),
    CONSTRAINT "session_evaluations_overall_score_check" CHECK ((("overall_score" >= 1) AND ("overall_score" <= 10))),
    CONSTRAINT "session_evaluations_tajweed_score_check" CHECK ((("tajweed_score" >= 1) AND ("tajweed_score" <= 10)))
);


ALTER TABLE "public"."session_evaluations" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."roster_recent_evaluations"("p_teacher_id" "uuid", "p_student_ids" "uuid"[]) RETURNS SETOF "public"."session_evaluations"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select se.*
  from public.session_evaluations se
  where se.id in (
    select id from (
      select id,
             row_number() over (partition by student_id order by evaluation_date desc) as rn
      from public.session_evaluations
      where teacher_id = p_teacher_id
        and student_id = any(p_student_ids)
    ) ranked
    where ranked.rn <= 5
  )
  order by se.evaluation_date desc;
$$;


ALTER FUNCTION "public"."roster_recent_evaluations"("p_teacher_id" "uuid", "p_student_ids" "uuid"[]) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_progress" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "progress_type" "text" DEFAULT 'new'::"text" NOT NULL,
    "surah_from" integer,
    "ayah_from" integer,
    "surah_to" integer,
    "ayah_to" integer,
    "pages_reviewed" integer,
    "quality_rating" integer,
    "level" "public"."student_level" DEFAULT 'beginner'::"public"."student_level" NOT NULL,
    "teacher_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recitation_standard" "text",
    CONSTRAINT "student_progress_ayah_from_positive" CHECK ((("ayah_from" IS NULL) OR ("ayah_from" >= 1))),
    CONSTRAINT "student_progress_ayah_to_positive" CHECK ((("ayah_to" IS NULL) OR ("ayah_to" >= 1))),
    CONSTRAINT "student_progress_pages_reviewed_check" CHECK (("pages_reviewed" >= 0)),
    CONSTRAINT "student_progress_progress_type_check" CHECK (("progress_type" = ANY (ARRAY['new'::"text", 'muraja'::"text", 'correction'::"text"]))),
    CONSTRAINT "student_progress_quality_rating_check" CHECK ((("quality_rating" >= 1) AND ("quality_rating" <= 5))),
    CONSTRAINT "student_progress_recitation_standard_check" CHECK (("recitation_standard" = ANY (ARRAY['hafs'::"text", 'warsh'::"text", 'qalon'::"text", 'al_duri'::"text", 'shu_ba'::"text"]))),
    CONSTRAINT "student_progress_surah_from_check" CHECK ((("surah_from" >= 1) AND ("surah_from" <= 114))),
    CONSTRAINT "student_progress_surah_to_check" CHECK ((("surah_to" >= 1) AND ("surah_to" <= 114))),
    CONSTRAINT "valid_progress_range" CHECK (((("surah_from" IS NULL) AND ("surah_to" IS NULL)) OR (("surah_from" IS NOT NULL) AND ("surah_to" IS NOT NULL) AND (("surah_to" > "surah_from") OR (("surah_to" = "surah_from") AND ("ayah_from" IS NOT NULL) AND ("ayah_to" IS NOT NULL) AND ("ayah_to" >= "ayah_from"))))))
);


ALTER TABLE "public"."student_progress" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."roster_recent_progress"("p_student_ids" "uuid"[]) RETURNS SETOF "public"."student_progress"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select sp.*
  from public.student_progress sp
  where sp.id in (
    select id from (
      select id,
             row_number() over (partition by student_id order by created_at desc) as rn
      from public.student_progress
      where student_id = any(p_student_ids)
        and progress_type = 'new'
    ) ranked
    where ranked.rn <= 5
  )
  order by sp.created_at desc;
$$;


ALTER FUNCTION "public"."roster_recent_progress"("p_student_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_teachers"("p_needle" "text", "p_limit" integer, "p_offset" integer) RETURNS TABLE("teacher_id" "uuid", "full_name" "text", "email" "text", "avatar_url" "text", "specialties" "text"[], "hourly_rate" numeric, "rating_avg" numeric, "total_sessions" integer, "is_accepting" boolean, "is_archived" boolean, "cv_status" "text", "total_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."search_teachers"("p_needle" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_cancelled_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'no_show') AND OLD.status NOT IN ('cancelled', 'no_show') THEN
    NEW.cancelled_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_cancelled_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_session_from_webhook"("p_session_id" "uuid", "p_started_at" timestamp with time zone, "p_event_id" "text", "p_room_name" "text", "p_payload_json" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."start_session_from_webhook"("p_session_id" "uuid", "p_started_at" timestamp with time zone, "p_event_id" "text", "p_room_name" "text", "p_payload_json" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_conv_ts"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_conv_ts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."teacher_at_risk_students"("p_teacher_id" "uuid", "p_limit" integer DEFAULT 5) RETURNS TABLE("student_id" "uuid", "full_name" "text", "churn_risk_score" double precision, "last_session_at" timestamp with time zone, "package_remaining" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select
    rs.student_id,
    coalesce(pr.full_name, '') as full_name,
    rs.churn_risk_score,
    rs.last_session_at::timestamptz,
    rs.package_remaining
  from (
    select distinct b.student_id
    from   public.bookings b
    where  b.teacher_id = p_teacher_id
  ) students
  join public.retention_signals rs
    on  rs.student_id   = students.student_id
    and rs.churn_risk_score >= 60
  left join public.profiles pr
    on  pr.id = rs.student_id
  order by rs.churn_risk_score desc nulls last
  limit p_limit;
$$;


ALTER FUNCTION "public"."teacher_at_risk_students"("p_teacher_id" "uuid", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."teacher_distinct_students"("p_teacher_id" "uuid") RETURNS TABLE("student_id" "uuid")
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select distinct b.student_id
  from   public.bookings b
  where  b.teacher_id = p_teacher_id;
$$;


ALTER FUNCTION "public"."teacher_distinct_students"("p_teacher_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tr_course_reviews_aggregate"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
begin
  -- INSERT / UPDATE: refresh aggregates for the affected course.
  -- DELETE: refresh for the (now-orphaned) old course_id.
  if tg_op = 'DELETE' then
    perform public.recompute_course_review_aggregates(old.course_id);
    return old;
  end if;

  perform public.recompute_course_review_aggregates(new.course_id);

  -- If course_id changed (rare — virtually never happens), also refresh old.
  if tg_op = 'UPDATE' and old.course_id is distinct from new.course_id then
    perform public.recompute_course_review_aggregates(old.course_id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."tr_course_reviews_aggregate"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_teacher_rating"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE t_id uuid;
BEGIN
  t_id := COALESCE(NEW.teacher_id, OLD.teacher_id);
  UPDATE teacher_profiles
  SET rating_avg = COALESCE(
    (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE teacher_id = t_id), 0)
  WHERE teacher_id = t_id;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_teacher_rating"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_is_session_participant"("s_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.session_participants
    WHERE session_id = s_id
      AND user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."user_is_session_participant"("s_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."user_is_session_participant"("s_id" "uuid") IS 'SECURITY DEFINER helper for the sessions_select_via_participants_v2 policy. Returns true iff the calling user has a session_participants row for the given session. Runs as function owner so the inner SELECT bypasses RLS, breaking the recursion that made the v1 policy infinite.';



CREATE OR REPLACE FUNCTION "public"."validate_booking_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF is_admin() THEN RETURN NEW; END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('confirmed', 'cancelled') THEN
    RETURN NEW;
  ELSIF OLD.status = 'confirmed' AND NEW.status IN ('completed', 'cancelled', 'no_show') THEN
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'Invalid status transition: % to %', OLD.status, NEW.status;
  END IF;
END;
$$;


ALTER FUNCTION "public"."validate_booking_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_credits_total"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.total < NEW.used THEN
    RAISE EXCEPTION 'Cannot reduce total below used (total=%, used=%)', NEW.total, NEW.used;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validate_credits_total"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_session_type"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  teacher_specialties text[];
begin
  -- Only validate when the booking is new, or when the columns the rule
  -- actually depends on changed. Pure status / metadata updates pass through.
  if tg_op = 'UPDATE'
     and new.teacher_id is not distinct from old.teacher_id
     and new.session_type is not distinct from old.session_type
  then
    return new;
  end if;

  select specialties into teacher_specialties
  from teacher_profiles
  where teacher_id = new.teacher_id;

  if teacher_specialties is not null
     and array_length(teacher_specialties, 1) > 0
     and not (new.session_type::text = any(teacher_specialties))
  then
    raise exception 'Teacher does not offer session type: %', new.session_type;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."validate_session_type"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_student_progress_range"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_from_count smallint;
  v_to_count smallint;
begin
  if new.surah_from is not null then
    select ayah_count into v_from_count from quran_surahs where surah_num = new.surah_from;
    if v_from_count is null then
      raise exception 'invalid surah_from %', new.surah_from using errcode = '23514';
    end if;
    if new.ayah_from is not null and new.ayah_from > v_from_count then
      raise exception 'ayah_from % exceeds surah % ayah count %', new.ayah_from, new.surah_from, v_from_count
        using errcode = '23514';
    end if;
  end if;

  if new.surah_to is not null then
    select ayah_count into v_to_count from quran_surahs where surah_num = new.surah_to;
    if v_to_count is null then
      raise exception 'invalid surah_to %', new.surah_to using errcode = '23514';
    end if;
    if new.ayah_to is not null and new.ayah_to > v_to_count then
      raise exception 'ayah_to % exceeds surah % ayah count %', new.ayah_to, new.surah_to, v_to_count
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validate_student_progress_range"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "changed_by" "uuid",
    "table_name" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "old_data" "jsonb",
    "new_data" "jsonb",
    "reason" "text",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text", 'LOGIN'::"text", 'LOGOUT'::"text"])))
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_dead_letter" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_name" "text" NOT NULL,
    "event_name" "text",
    "entity_type" "text",
    "entity_id" "uuid",
    "idempotency_key" "text",
    "payload_json" "jsonb",
    "last_error" "text",
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "first_failed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_failed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "resolution_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."automation_dead_letter" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_name" "text" NOT NULL,
    "event_name" "text",
    "entity_type" "text",
    "entity_id" "uuid",
    "idempotency_key" "text",
    "status" "text" DEFAULT 'started'::"text" NOT NULL,
    "channel" "text",
    "payload_json" "jsonb",
    "result_json" "jsonb",
    "error_message" "text",
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "trace_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "automation_logs_status_check" CHECK (("status" = ANY (ARRAY['started'::"text", 'succeeded'::"text", 'failed'::"text", 'skipped'::"text"])))
);


ALTER TABLE "public"."automation_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."availability_exceptions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "is_blocked" boolean DEFAULT true NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "exception_time_order" CHECK ((("start_time" IS NULL) OR ("end_time" IS NULL) OR ("end_time" > "start_time")))
);


ALTER TABLE "public"."availability_exceptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blog_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title_ar" "text" NOT NULL,
    "title_en" "text" NOT NULL,
    "excerpt_ar" "text" NOT NULL,
    "excerpt_en" "text" NOT NULL,
    "body_ar" "text" NOT NULL,
    "body_en" "text" NOT NULL,
    "category_ar" "text" NOT NULL,
    "category_en" "text" NOT NULL,
    "color" "text" DEFAULT 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'::"text" NOT NULL,
    "read_time_ar" "text" DEFAULT '٥ دقائق'::"text" NOT NULL,
    "read_time_en" "text" DEFAULT '5 min'::"text" NOT NULL,
    "published_at" timestamp with time zone DEFAULT "now"(),
    "is_published" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "cover_image_path" "text",
    "cover_alt_en" "text",
    "cover_alt_ar" "text"
);


ALTER TABLE "public"."blog_posts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."blog_posts"."cover_image_path" IS 'Storage path inside the blog-images bucket. Format: {post_id}/cover.{ext}. NULL when no hero image is set.';



COMMENT ON COLUMN "public"."blog_posts"."cover_alt_en" IS 'English alt-text for the cover image. Typed by the admin in /admin/blog/[id]/edit.';



COMMENT ON COLUMN "public"."blog_posts"."cover_alt_ar" IS 'Arabic alt-text for the cover image. Typed by the admin in /admin/blog/[id]/edit.';



CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "rescheduled_from" "uuid",
    "refund_policy_id" "uuid",
    "scheduled_at" timestamp with time zone NOT NULL,
    "duration_min" integer NOT NULL,
    "status" "public"."booking_status" DEFAULT 'pending'::"public"."booking_status" NOT NULL,
    "session_type" "public"."session_type" DEFAULT 'hifz'::"public"."session_type" NOT NULL,
    "rate_snapshot" numeric(10,2) NOT NULL,
    "amount_usd" numeric(10,2) NOT NULL,
    "amount_local" numeric(12,2),
    "local_currency" "text",
    "exchange_rate" numeric(10,6),
    "tax_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "cancelled_by" "uuid",
    "cancel_reason" "text",
    "cancelled_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "teacher_confirmed" boolean DEFAULT false NOT NULL,
    "teacher_confirmed_at" timestamp with time zone,
    "decline_reason" "text",
    "student_package_id" "uuid",
    "session_id" "uuid",
    "class_offering_id" "uuid",
    "cancel_reason_code" "public"."booking_cancel_reason_code",
    "cancel_reason_detail" "text",
    CONSTRAINT "bookings_amount_usd_check" CHECK (("amount_usd" > (0)::numeric)),
    CONSTRAINT "bookings_duration_min_check" CHECK (("duration_min" = ANY (ARRAY[30, 45, 60]))),
    CONSTRAINT "bookings_local_currency_check" CHECK (("local_currency" = "upper"("local_currency"))),
    CONSTRAINT "no_self_booking" CHECK (("student_id" <> "teacher_id")),
    CONSTRAINT "no_self_reschedule" CHECK ((("rescheduled_from" IS NULL) OR ("rescheduled_from" <> "id")))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_offerings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "scheduled_at" timestamp with time zone NOT NULL,
    "duration_min" integer NOT NULL,
    "session_type" "public"."session_type" NOT NULL,
    "capacity" integer NOT NULL,
    "price_usd" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "session_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "class_offerings_capacity_check" CHECK ((("capacity" >= 2) AND ("capacity" <= 20))),
    CONSTRAINT "class_offerings_duration_min_check" CHECK ((("duration_min" >= 15) AND ("duration_min" <= 240))),
    CONSTRAINT "class_offerings_price_usd_check" CHECK (("price_usd" >= (0)::numeric)),
    CONSTRAINT "class_offerings_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'full'::"text", 'confirmed'::"text", 'cancelled'::"text", 'completed'::"text"]))),
    CONSTRAINT "class_offerings_title_check" CHECK ((("length"("title") >= 1) AND ("length"("title") <= 200)))
);


ALTER TABLE "public"."class_offerings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."communication_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "preferred_language" "text" DEFAULT 'ar'::"text" NOT NULL,
    "email_enabled" boolean DEFAULT true NOT NULL,
    "whatsapp_enabled" boolean DEFAULT true NOT NULL,
    "in_app_enabled" boolean DEFAULT true NOT NULL,
    "quiet_hours_start" time without time zone,
    "quiet_hours_end" time without time zone,
    "important_only_mode" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_preferences_preferred_language_check" CHECK (("preferred_language" = ANY (ARRAY['ar'::"text", 'en'::"text", 'bilingual'::"text"])))
);


ALTER TABLE "public"."communication_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "whatsapp" "text",
    "country" "text",
    "student_age" "text",
    "package_interest" "text",
    "message" "text",
    "is_read" boolean DEFAULT false,
    "is_replied" boolean DEFAULT false,
    "admin_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."contact_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "initiated_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "last_message_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"]))),
    CONSTRAINT "no_self_conv" CHECK (("student_id" <> "teacher_id"))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_enrollments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "payment_id" "uuid",
    "amount_paid_cents" integer DEFAULT 0,
    "platform_fee_cents" integer DEFAULT 0,
    "teacher_earnings_cents" integer DEFAULT 0,
    "currency" "text",
    "enrolled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "last_accessed_at" timestamp with time zone,
    CONSTRAINT "course_enrollments_currency_check" CHECK (("currency" = ANY (ARRAY['USD'::"text", 'EGP'::"text"]))),
    CONSTRAINT "course_enrollments_source_check" CHECK (("source" = ANY (ARRAY['free'::"text", 'purchase'::"text", 'admin_grant'::"text"])))
);


ALTER TABLE "public"."course_enrollments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_lesson_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "enrollment_id" "uuid" NOT NULL,
    "lesson_id" "uuid" NOT NULL,
    "last_position_seconds" integer DEFAULT 0 NOT NULL,
    "completed_at" timestamp with time zone,
    "watch_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hidden_from_dashboard" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."course_lesson_progress" OWNER TO "postgres";


COMMENT ON COLUMN "public"."course_lesson_progress"."hidden_from_dashboard" IS 'When true, the lesson is excluded from the student dashboard "Continue Watching" table. Used by the per-row "Hide from list" action. Lesson remains accessible from the course page.';



CREATE TABLE IF NOT EXISTS "public"."course_lessons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "order_index" integer NOT NULL,
    "title_ar" "text" NOT NULL,
    "title_en" "text",
    "description_ar" "text",
    "description_en" "text",
    "bunny_video_id" "text",
    "video_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "duration_seconds" integer,
    "is_preview" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_lessons_video_status_check" CHECK (("video_status" = ANY (ARRAY['pending'::"text", 'uploading'::"text", 'processing'::"text", 'ready'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."course_lessons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "total_sales_cents" integer DEFAULT 0 NOT NULL,
    "platform_fee_cents" integer DEFAULT 0 NOT NULL,
    "teacher_earnings_cents" integer DEFAULT 0 NOT NULL,
    "currency" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "paid_out_at" timestamp with time zone,
    "payout_reference" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_payouts_check" CHECK (("period_end" >= "period_start")),
    CONSTRAINT "course_payouts_currency_check" CHECK (("currency" = ANY (ARRAY['USD'::"text", 'EGP'::"text"]))),
    CONSTRAINT "course_payouts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."course_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."course_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "enrollment_id" "uuid" NOT NULL,
    "stars" integer NOT NULL,
    "comment" "text",
    "status" "text" DEFAULT 'published'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_reviews_stars_check" CHECK ((("stars" >= 1) AND ("stars" <= 5))),
    CONSTRAINT "course_reviews_status_check" CHECK (("status" = ANY (ARRAY['published'::"text", 'hidden'::"text"])))
);


ALTER TABLE "public"."course_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid",
    "slug" "text" NOT NULL,
    "title_ar" "text" NOT NULL,
    "title_en" "text",
    "description_ar" "text",
    "description_en" "text",
    "cover_image_url" "text",
    "intro_bunny_video_id" "text",
    "pricing_type" "text" DEFAULT 'free'::"text" NOT NULL,
    "price_cents" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "level" "text",
    "language" "text",
    "specialty" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "rejection_reason" "text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "duration_seconds_cached" integer DEFAULT 0,
    "lesson_count_cached" integer DEFAULT 0,
    "enrollment_count_cached" integer DEFAULT 0,
    "rating_avg_cached" numeric(3,2),
    "rating_count_cached" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "ownership" "text" DEFAULT 'teacher'::"text" NOT NULL,
    "teacher_revenue_share_bps" integer DEFAULT 7000 NOT NULL,
    CONSTRAINT "courses_currency_check" CHECK (("currency" = ANY (ARRAY['USD'::"text", 'EGP'::"text"]))),
    CONSTRAINT "courses_language_check" CHECK (("language" = ANY (ARRAY['ar'::"text", 'en'::"text", 'both'::"text"]))),
    CONSTRAINT "courses_level_check" CHECK (("level" = ANY (ARRAY['beginner'::"text", 'intermediate'::"text", 'advanced'::"text"]))),
    CONSTRAINT "courses_ownership_check" CHECK (("ownership" = ANY (ARRAY['platform'::"text", 'teacher'::"text"]))),
    CONSTRAINT "courses_ownership_consistent" CHECK (((("ownership" = 'platform'::"text") AND ("teacher_id" IS NULL) AND ("teacher_revenue_share_bps" = 0)) OR (("ownership" = 'teacher'::"text") AND ("teacher_id" IS NOT NULL)))),
    CONSTRAINT "courses_price_cents_check" CHECK (("price_cents" >= 0)),
    CONSTRAINT "courses_pricing_consistent" CHECK (((("pricing_type" = 'free'::"text") AND ("price_cents" = 0)) OR (("pricing_type" = 'one_time'::"text") AND ("price_cents" > 0)))),
    CONSTRAINT "courses_pricing_type_check" CHECK (("pricing_type" = ANY (ARRAY['free'::"text", 'one_time'::"text"]))),
    CONSTRAINT "courses_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'published'::"text", 'archived'::"text", 'rejected'::"text"]))),
    CONSTRAINT "courses_teacher_revenue_share_bps_check" CHECK ((("teacher_revenue_share_bps" >= 0) AND ("teacher_revenue_share_bps" <= 10000)))
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_webhook_events" (
    "event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "room_name" "text",
    "session_id" "uuid",
    "payload_json" "jsonb" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "daily_webhook_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['meeting.started'::"text", 'meeting.ended'::"text"])))
);


ALTER TABLE "public"."daily_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_likes" (
    "user_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "forum_likes_target_type_check" CHECK (("target_type" = ANY (ARRAY['thread'::"text", 'reply'::"text"])))
);


ALTER TABLE "public"."forum_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_replies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "author_id" "uuid" NOT NULL,
    "body_ar" "text" NOT NULL,
    "body_en" "text",
    "is_hidden" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."forum_replies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forum_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "reason" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "forum_reports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'resolved'::"text", 'dismissed'::"text"]))),
    CONSTRAINT "forum_reports_target_type_check" CHECK (("target_type" = ANY (ARRAY['thread'::"text", 'reply'::"text"])))
);


ALTER TABLE "public"."forum_reports" OWNER TO "postgres";


COMMENT ON TABLE "public"."forum_reports" IS 'User-submitted reports of threads/replies that violate guidelines. Pending status routes to /admin/community for resolution.';



CREATE TABLE IF NOT EXISTS "public"."forum_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" NOT NULL,
    "title_ar" "text" NOT NULL,
    "title_en" "text",
    "body_ar" "text" NOT NULL,
    "body_en" "text",
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "is_pinned" boolean DEFAULT false NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "is_hidden" boolean DEFAULT false NOT NULL,
    "reply_count" integer DEFAULT 0 NOT NULL,
    "last_reply_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."forum_threads" OWNER TO "postgres";


COMMENT ON TABLE "public"."forum_threads" IS 'Community forum threads. Authored by any logged-in user; moderated by admin/mod via is_pinned/is_locked/is_hidden flags.';



CREATE TABLE IF NOT EXISTS "public"."halaqa_waiting_list" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "position" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "promoted_at" timestamp with time zone,
    CONSTRAINT "halaqa_waiting_list_position_check" CHECK (("position" >= 1))
);


ALTER TABLE "public"."halaqa_waiting_list" OWNER TO "postgres";


COMMENT ON TABLE "public"."halaqa_waiting_list" IS 'Halaqa "join the waiting list" queue. One row per (session, student) waiting on a full halaqa to free up a seat. Stage 5 enrollment cancellation flow promotes position=1 and decrements the rest.';



COMMENT ON COLUMN "public"."halaqa_waiting_list"."position" IS 'Position in line, starting at 1. Cancellation promotes position=1 and decrements every other row by 1.';



COMMENT ON COLUMN "public"."halaqa_waiting_list"."promoted_at" IS 'Set when the row was promoted off the list (a seat opened up and this student was offered it). Null while still waiting. Stage 5 will keep promoted rows around briefly so the student-facing notification can render the "you got in" CTA without re-querying participants.';



CREATE TABLE IF NOT EXISTS "public"."help_articles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title_ar" "text" NOT NULL,
    "title_en" "text",
    "body_ar" "text" NOT NULL,
    "body_en" "text",
    "category" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."help_articles" OWNER TO "postgres";


COMMENT ON TABLE "public"."help_articles" IS 'In-app knowledge base articles. Authored at /admin/help, served publicly at /help. RLS gates reads to is_published=true rows for non-admins.';



CREATE TABLE IF NOT EXISTS "public"."help_categories" (
    "slug" "text" NOT NULL,
    "label_ar" "text" NOT NULL,
    "label_en" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."help_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."homework_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid",
    "booking_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "homework_type" "public"."homework_type" NOT NULL,
    "status" "public"."homework_status" DEFAULT 'assigned'::"public"."homework_status" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "surah_number" smallint,
    "ayah_start" smallint,
    "ayah_end" smallint,
    "pages_count" smallint,
    "due_date" "date",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ready_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "teacher_notes" "text",
    "parent_assignment_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "audio_url" "text",
    "audio_duration_seconds" integer,
    "review_horizon" "text" DEFAULT 'none'::"text" NOT NULL,
    CONSTRAINT "ayah_range_valid" CHECK ((("ayah_end" IS NULL) OR ("ayah_start" IS NULL) OR ("ayah_end" >= "ayah_start"))),
    CONSTRAINT "homework_assignments_audio_duration_check" CHECK ((("audio_duration_seconds" IS NULL) OR (("audio_duration_seconds" >= 1) AND ("audio_duration_seconds" <= 300)))),
    CONSTRAINT "homework_assignments_ayah_end_check" CHECK (("ayah_end" >= 1)),
    CONSTRAINT "homework_assignments_ayah_start_check" CHECK (("ayah_start" >= 1)),
    CONSTRAINT "homework_assignments_pages_count_check" CHECK (("pages_count" >= 1)),
    CONSTRAINT "homework_assignments_surah_number_check" CHECK ((("surah_number" >= 1) AND ("surah_number" <= 114))),
    CONSTRAINT "review_horizon_valid" CHECK (("review_horizon" = ANY (ARRAY['near'::"text", 'far'::"text", 'none'::"text"])))
);


ALTER TABLE "public"."homework_assignments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."homework_assignments"."audio_url" IS 'Storage path inside the homework-audio bucket. Format: {student_id}/{homework_id}/{ts}.webm. NULL when the student submitted without audio.';



COMMENT ON COLUMN "public"."homework_assignments"."audio_duration_seconds" IS 'Length of the recorded audio in whole seconds. Constrained 1-300; UI caps at 90 by default.';



CREATE TABLE IF NOT EXISTS "public"."ijazah_pathways" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name_ar" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "description_ar" "text",
    "description_en" "text",
    "recitation_standard" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ijazah_pathways_recitation_standard_check" CHECK (("recitation_standard" = ANY (ARRAY['hafs'::"text", 'warsh'::"text", 'qalon'::"text", 'al_duri'::"text", 'shu_ba'::"text"])))
);


ALTER TABLE "public"."ijazah_pathways" OWNER TO "postgres";


COMMENT ON TABLE "public"."ijazah_pathways" IS 'Credential pathways the academy offers (e.g. "Hifz al-Quran complete in Hafs"). One pathway, many requirements.';



CREATE TABLE IF NOT EXISTS "public"."ijazah_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pathway_id" "uuid" NOT NULL,
    "requirement_type" "text" NOT NULL,
    "requirement_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sequence" integer NOT NULL,
    "description_ar" "text" NOT NULL,
    "description_en" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ijazah_requirements_requirement_type_check" CHECK (("requirement_type" = ANY (ARRAY['memorize_surah'::"text", 'memorize_juz'::"text", 'min_sessions_with_teacher'::"text", 'eval_score_threshold'::"text", 'oral_exam_pass'::"text", 'written_exam_pass'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."ijazah_requirements" OWNER TO "postgres";


COMMENT ON TABLE "public"."ijazah_requirements" IS 'Requirements composing a pathway. payload examples: {"surah_num":2} for memorize_surah.';



CREATE SEQUENCE IF NOT EXISTS "public"."invoice_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."invoice_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "invoice_number" "text" NOT NULL,
    "issued_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pdf_url" "text",
    "student_name_snapshot" "text" NOT NULL,
    "amount_usd" numeric(10,2) NOT NULL,
    "tax_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "currency" "text" NOT NULL,
    "exchange_rate_snapshot" numeric(10,6),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legal_document_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "version" integer NOT NULL,
    "body_ar" "text",
    "body_en" "text",
    "effective_at" timestamp with time zone NOT NULL,
    "superseded_at" timestamp with time zone,
    "saved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "legal_document_versions_kind_check" CHECK (("kind" = ANY (ARRAY['terms'::"text", 'privacy'::"text"])))
);


ALTER TABLE "public"."legal_document_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legal_documents" (
    "kind" "text" NOT NULL,
    "body_ar" "text",
    "body_en" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "legal_documents_kind_check" CHECK (("kind" = ANY (ARRAY['terms'::"text", 'privacy'::"text"])))
);


ALTER TABLE "public"."legal_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_delivery_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "recipient_channel" "text" NOT NULL,
    "template_name" "text",
    "related_entity_type" "text",
    "related_entity_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "provider_message_id" "text",
    "attempted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "delivered_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "failure_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "message_delivery_log_recipient_channel_check" CHECK (("recipient_channel" = ANY (ARRAY['in_app'::"text", 'email'::"text", 'whatsapp'::"text", 'telegram'::"text", 'sms'::"text"]))),
    CONSTRAINT "message_delivery_log_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'delivered'::"text", 'failed'::"text", 'throttled'::"text"])))
);


ALTER TABLE "public"."message_delivery_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "msg_type" "public"."msg_type" DEFAULT 'text'::"public"."msg_type" NOT NULL,
    "file_url" "text",
    "is_read" boolean DEFAULT false NOT NULL,
    "edited_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "flagged_at" timestamp with time zone,
    "flagged_by" "uuid",
    "flag_reason" "text",
    "hidden_at" timestamp with time zone,
    "hidden_by" "uuid",
    CONSTRAINT "messages_content_check" CHECK ((("length"("content") >= 1) AND ("length"("content") <= 5000)))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."module_lessons" (
    "module_id" "uuid" NOT NULL,
    "lesson_id" "uuid" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."module_lessons" OWNER TO "postgres";


COMMENT ON TABLE "public"."module_lessons" IS 'Module ↔ lesson assignment. Lessons unique per (module_id) — a lesson belongs to at most one module.';



CREATE TABLE IF NOT EXISTS "public"."modules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "title_ar" "text" NOT NULL,
    "title_en" "text",
    "description_ar" "text",
    "description_en" "text",
    "is_linear" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."modules" OWNER TO "postgres";


COMMENT ON TABLE "public"."modules" IS 'Curriculum modules — groups of lessons with optional linear sequencing. When is_linear=true, students must complete earlier lessons in the module before later ones unlock.';



CREATE TABLE IF NOT EXISTS "public"."notification_broadcasts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "target" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "initiated_by" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "cursor_after" "uuid",
    "recipients_sent" integer DEFAULT 0 NOT NULL,
    "recipients_failed" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    CONSTRAINT "notification_broadcasts_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'sent'::"text", 'failed'::"text"]))),
    CONSTRAINT "notification_broadcasts_target_check" CHECK (("target" = ANY (ARRAY['all'::"text", 'student'::"text", 'teacher'::"text"])))
);


ALTER TABLE "public"."notification_broadcasts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "public"."notif_type" NOT NULL,
    "channel" "text"[] DEFAULT '{in_app}'::"text"[] NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "data" "jsonb",
    "is_read" boolean DEFAULT false NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notifications_channel_check" CHECK (("channel" <@ ARRAY['in_app'::"text", 'email'::"text", 'push'::"text"]))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "package_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "name_ar" "text",
    "description" "text",
    "description_ar" "text",
    "session_count" integer NOT NULL,
    "duration_min" integer DEFAULT 30 NOT NULL,
    "price_usd" numeric(10,2) NOT NULL,
    "price_gbp" numeric(10,2),
    "price_sar" numeric(10,2),
    "price_aud" numeric(10,2),
    "features" "text"[] DEFAULT '{}'::"text"[],
    "features_ar" "text"[] DEFAULT '{}'::"text"[],
    "is_featured" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "display_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_mode_allowances" "jsonb" DEFAULT '{"halaqa": 0, "lecture": 0, "private": 0}'::"jsonb" NOT NULL,
    "halaqa_pricing_tiers" "jsonb" DEFAULT '[]'::"jsonb",
    "supports_session_modes" "text"[] DEFAULT ARRAY['private'::"text"] NOT NULL,
    CONSTRAINT "packages_package_type_check" CHECK (("package_type" = ANY (ARRAY['single_session'::"text", 'pack_4'::"text", 'pack_8'::"text", 'pack_12'::"text", 'full_course'::"text"]))),
    CONSTRAINT "packages_price_usd_check" CHECK (("price_usd" > (0)::numeric)),
    CONSTRAINT "packages_session_count_check" CHECK (("session_count" > 0))
);


ALTER TABLE "public"."packages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."packages"."session_mode_allowances" IS 'Per-mode session count: { "private": N, "halaqa": M, "lecture": K }. Defaults to all-zero. Legacy packages with session_count > 0 implicitly grant `private` via the fallback in deduct_package_session_mode().';



COMMENT ON COLUMN "public"."packages"."halaqa_pricing_tiers" IS 'Reserved for Stage 5 halaqa per-seat pricing ladder. Defaults to empty array.';



COMMENT ON COLUMN "public"."packages"."supports_session_modes" IS 'Which modes this package can be used to book. Defaults to {''private''} for backwards compat. Stage 5 admin package editor surfaces this as a multi-select.';



CREATE TABLE IF NOT EXISTS "public"."parent_reports" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "report_type" "public"."report_type" NOT NULL,
    "content" "text" NOT NULL,
    "sent_via" "text"[] DEFAULT '{email}'::"text"[],
    "sent_at" timestamp with time zone,
    "parent_email" "text",
    "parent_phone" "text",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text"
);


ALTER TABLE "public"."parent_reports" OWNER TO "postgres";


COMMENT ON COLUMN "public"."parent_reports"."title" IS 'Short subject line for the parent report (e.g. "ملخص جلسة 2026-05-06"). Added via 20260506_ensure_parent_reports_title to recover from schema drift detected by Sentry E4-1D/-1C.';



CREATE TABLE IF NOT EXISTS "public"."payment_transactions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "amount_usd" numeric(10,2) NOT NULL,
    "stripe_id" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_transactions_amount_usd_check" CHECK (("amount_usd" > (0)::numeric)),
    CONSTRAINT "payment_transactions_type_check" CHECK (("type" = ANY (ARRAY['charge'::"text", 'refund'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."payment_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid",
    "student_id" "uuid" NOT NULL,
    "stripe_payment_intent" "text",
    "amount_usd" numeric(10,2) NOT NULL,
    "amount_local" numeric(12,2),
    "local_currency" "text",
    "exchange_rate_snapshot" numeric(10,6),
    "amount_before_tax" numeric(10,2) DEFAULT 0 NOT NULL,
    "tax_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(10,2) DEFAULT 0 NOT NULL,
    "revenue_recognized" numeric(10,2) DEFAULT 0 NOT NULL,
    "status" "public"."payment_status" DEFAULT 'pending'::"public"."payment_status" NOT NULL,
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider" "text" DEFAULT 'stripe'::"text" NOT NULL,
    "paypal_order_id" "text",
    "paypal_capture_id" "text",
    "captured_at" timestamp with time zone,
    "payer_email" "text",
    "package_id" "uuid",
    CONSTRAINT "payment_tax_check" CHECK (("amount_usd" = ("amount_before_tax" + "tax_amount"))),
    CONSTRAINT "payments_amount_usd_check" CHECK (("amount_usd" > (0)::numeric)),
    CONSTRAINT "payments_local_currency_check" CHECK (("local_currency" = "upper"("local_currency"))),
    CONSTRAINT "payments_provider_check" CHECK (("provider" = ANY (ARRAY['stripe'::"text", 'paypal'::"text", 'manual'::"text"]))),
    CONSTRAINT "payments_provider_id_check" CHECK (((("provider" = 'paypal'::"text") AND ("paypal_order_id" IS NOT NULL)) OR (("provider" = 'stripe'::"text") AND ("stripe_payment_intent" IS NOT NULL)) OR ("provider" = 'manual'::"text")))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "description" "text",
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."platform_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "role" "public"."user_role" DEFAULT 'student'::"public"."user_role" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "phone" "text",
    "country" "text",
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "lang" "text" DEFAULT 'ar'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_name" "text",
    "parent_phone" "text",
    "parent_email" "text",
    "date_of_birth" "date",
    "full_name_ar" "text",
    "roles" "public"."user_role"[] DEFAULT ARRAY['student'::"public"."user_role"] NOT NULL,
    CONSTRAINT "profiles_active_role_in_set" CHECK (("role" = ANY ("roles"))),
    CONSTRAINT "profiles_phone_check" CHECK (("phone" ~ '^\+?[0-9]{7,15}$'::"text")),
    CONSTRAINT "profiles_role_no_moderator" CHECK (("role" <> 'moderator'::"public"."user_role")),
    CONSTRAINT "profiles_roles_no_moderator" CHECK ((NOT ('moderator'::"public"."user_role" = ANY ("roles"))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."full_name_ar" IS 'Manually-entered Arabic spelling of the user''s name. Used for public/admin display when lang=ar. Falls back to full_name when null.';



CREATE OR REPLACE VIEW "public"."public_profiles" AS
 SELECT "id",
    "full_name",
    "full_name_ar",
    "avatar_url",
    "role"
   FROM "public"."profiles";


ALTER VIEW "public"."public_profiles" OWNER TO "postgres";


COMMENT ON VIEW "public"."public_profiles" IS 'Non-PII identity projection of profiles (id, full_name, full_name_ar, avatar_url, role) for displaying names/avatars of users the caller is not a teacher<->student counterparty of. Carries no phone/parent/dob/whatsapp/country. See audit HIGH-1.';



CREATE TABLE IF NOT EXISTS "public"."quiz_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quiz_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone,
    "answers" "jsonb",
    "score_pct" numeric,
    "passed" boolean,
    "duration_seconds" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quiz_attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."quiz_attempts" IS 'One row per student attempt; score_pct + passed populated by gradeQuizAttempt at submit time.';



CREATE TABLE IF NOT EXISTS "public"."quiz_question_keys" (
    "question_id" "uuid" NOT NULL,
    "correct_answer" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quiz_question_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quiz_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quiz_id" "uuid" NOT NULL,
    "question_ar" "text" NOT NULL,
    "question_en" "text",
    "question_type" "text" NOT NULL,
    "options" "jsonb",
    "points" integer DEFAULT 1 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "quiz_questions_points_check" CHECK (("points" >= 0)),
    CONSTRAINT "quiz_questions_question_type_check" CHECK (("question_type" = ANY (ARRAY['mcq'::"text", 'fill_in'::"text", 'true_false'::"text"])))
);


ALTER TABLE "public"."quiz_questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quizzes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "lesson_id" "uuid",
    "title_ar" "text" NOT NULL,
    "title_en" "text",
    "description_ar" "text",
    "description_en" "text",
    "time_limit_minutes" integer,
    "passing_score_pct" integer DEFAULT 70 NOT NULL,
    "available_at" timestamp with time zone,
    "due_at" timestamp with time zone,
    "is_published" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "quizzes_passing_score_pct_check" CHECK ((("passing_score_pct" >= 0) AND ("passing_score_pct" <= 100)))
);


ALTER TABLE "public"."quizzes" OWNER TO "postgres";


COMMENT ON TABLE "public"."quizzes" IS 'Quiz definitions per course/lesson. Time-limited and auto-graded text quizzes (MCQ + fill-in + true/false).';



CREATE TABLE IF NOT EXISTS "public"."quran_surahs" (
    "surah_num" smallint NOT NULL,
    "ayah_count" smallint NOT NULL,
    "juz_start" smallint,
    CONSTRAINT "quran_surahs_ayah_count_check" CHECK (("ayah_count" > 0)),
    CONSTRAINT "quran_surahs_surah_num_check" CHECK ((("surah_num" >= 1) AND ("surah_num" <= 114)))
);


ALTER TABLE "public"."quran_surahs" OWNER TO "postgres";


COMMENT ON TABLE "public"."quran_surahs" IS 'Canonical per-surah ayah counts (Hafs/Madani mushaf, total 6236). Count authority for the student_progress range guard. Names live in src/lib/quran/surahs.ts.';



CREATE TABLE IF NOT EXISTS "public"."recitation_errors" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "progress_id" "uuid" NOT NULL,
    "surah_num" integer,
    "ayah_num" integer NOT NULL,
    "error_type" "text" NOT NULL,
    "note" "text",
    "resolved" boolean DEFAULT false NOT NULL,
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recitation_errors_error_type_check" CHECK (("error_type" = ANY (ARRAY['makharij'::"text", 'sifat'::"text", 'madd'::"text", 'waqf'::"text", 'ghunna'::"text", 'other'::"text"]))),
    CONSTRAINT "recitation_errors_surah_num_check" CHECK ((("surah_num" >= 1) AND ("surah_num" <= 114))),
    CONSTRAINT "recitation_errors_surah_required" CHECK ((("surah_num" IS NOT NULL) OR (NOT ("note" IS DISTINCT FROM '__no_errors_observed_sentinel__'::"text"))))
);


ALTER TABLE "public"."recitation_errors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."refund_policies" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "hours_before_min" integer NOT NULL,
    "hours_before_max" integer,
    "refund_percentage" numeric(5,2) NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "refund_policies_refund_percentage_check" CHECK ((("refund_percentage" >= (0)::numeric) AND ("refund_percentage" <= (100)::numeric))),
    CONSTRAINT "valid_hours_range" CHECK ((("hours_before_max" IS NULL) OR ("hours_before_max" > "hours_before_min")))
);


ALTER TABLE "public"."refund_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."remote_handoff_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code_hash" "text" NOT NULL,
    "admin_user_id" "uuid" NOT NULL,
    "target_path" "text" NOT NULL,
    "supabase_token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval) NOT NULL,
    "used_at" timestamp with time zone,
    "used_ip" "inet",
    "used_ua" "text",
    CONSTRAINT "remote_handoff_tokens_target_path_admin_only" CHECK ((("target_path" ~~ '/admin/%'::"text") AND ("target_path" !~~ '//%'::"text")))
);


ALTER TABLE "public"."remote_handoff_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resource_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "student_id" "uuid",
    "halaqa_id" "uuid",
    "assigned_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "resource_assignments_check" CHECK ((((("student_id" IS NOT NULL))::integer + (("halaqa_id" IS NOT NULL))::integer) = 1))
);


ALTER TABLE "public"."resource_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title_ar" "text" NOT NULL,
    "title_en" "text",
    "description_ar" "text",
    "description_en" "text",
    "resource_type" "text" NOT NULL,
    "file_url" "text",
    "external_url" "text",
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "tags" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by_teacher_id" "uuid",
    CONSTRAINT "resources_check" CHECK ((("file_url" IS NOT NULL) OR ("external_url" IS NOT NULL))),
    CONSTRAINT "resources_resource_type_check" CHECK (("resource_type" = ANY (ARRAY['pdf'::"text", 'audio'::"text", 'link'::"text", 'video'::"text", 'image'::"text"])))
);


ALTER TABLE "public"."resources" OWNER TO "postgres";


COMMENT ON TABLE "public"."resources" IS 'Free-floating study materials (PDFs, audio, links, etc.) decoupled from courses. Public-readable when is_published=true; admin-authored at /admin/resources.';



CREATE TABLE IF NOT EXISTS "public"."retention_signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "last_booking_at" timestamp with time zone,
    "last_session_at" timestamp with time zone,
    "last_login_at" timestamp with time zone,
    "package_remaining" integer,
    "package_expires_at" timestamp with time zone,
    "engagement_score" numeric(5,2),
    "churn_risk_score" numeric(5,2),
    "last_intervention_at" timestamp with time zone,
    "intervention_type" "text",
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."retention_signals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "comment" "text",
    "teacher_reply" "text",
    "is_public" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schema_migrations" (
    "version" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text",
    "applied_by" "text"
);


ALTER TABLE "public"."schema_migrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "title_ar" "text",
    "description" "text" NOT NULL,
    "description_ar" "text",
    "features" "text"[] DEFAULT '{}'::"text"[],
    "features_ar" "text"[] DEFAULT '{}'::"text"[],
    "icon" "text",
    "image_url" "text",
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_notes_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "notes" "text" NOT NULL,
    "saved_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."session_notes_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_observers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "observer_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone,
    "left_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."session_observers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."participant_role" NOT NULL,
    "attendance_status" "public"."attendance_status" DEFAULT 'registered'::"public"."attendance_status" NOT NULL,
    "joined_at" timestamp with time zone,
    "left_at" timestamp with time zone,
    "daily_token" "text",
    "booking_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."session_participants" OWNER TO "postgres";


COMMENT ON TABLE "public"."session_participants" IS 'Halaqa enrollment records. NOT used for legacy private sessions (those derive participants from bookings) or for admin observation (session_observers is canonical). Stage 2 will add RLS; Stage 5 begins writing rows on halaqa enrollment.';



CREATE TABLE IF NOT EXISTS "public"."session_presence_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_info" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "session_presence_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['joined'::"text", 'left'::"text", 'rejoined'::"text", 'disconnected'::"text"])))
);


ALTER TABLE "public"."session_presence_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sessions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "booking_id" "uuid",
    "room_name" "text" DEFAULT ''::"text" NOT NULL,
    "room_url" "text" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_via" "text" DEFAULT 'auto'::"text" NOT NULL,
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "actual_duration" integer,
    "recording_url" "text",
    "teacher_joined" boolean DEFAULT false NOT NULL,
    "student_joined" boolean DEFAULT false NOT NULL,
    "post_session_notes" "text",
    "homework" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "admin_observer_id" "uuid",
    "is_observable" boolean DEFAULT true NOT NULL,
    "observer_joined_at" timestamp with time zone,
    "lesson_plan" "jsonb",
    "is_group" boolean DEFAULT false NOT NULL,
    "capacity" integer DEFAULT 1 NOT NULL,
    "session_mode" "public"."session_mode" DEFAULT 'private'::"public"."session_mode" NOT NULL,
    "min_participants" integer DEFAULT 1 NOT NULL,
    "current_enrollment" integer DEFAULT 0 NOT NULL,
    "allow_recording" boolean DEFAULT false NOT NULL,
    "surah_reference" "text",
    "ayah_range" "text",
    "session_topic_ar" "text",
    "session_topic_en" "text",
    "daily_room_mode" "text" DEFAULT 'default'::"text" NOT NULL,
    "external_lecture_url" "text",
    "scheduled_at" timestamp with time zone,
    CONSTRAINT "session_time_order" CHECK ((("ended_at" IS NULL) OR ("started_at" IS NULL) OR ("ended_at" > "started_at"))),
    CONSTRAINT "sessions_capacity_range" CHECK ((("capacity" >= 1) AND ("capacity" <= 20))),
    CONSTRAINT "sessions_created_via_check" CHECK (("created_via" = ANY (ARRAY['webhook'::"text", 'manual'::"text", 'auto'::"text"]))),
    CONSTRAINT "sessions_current_enrollment_check" CHECK (("current_enrollment" >= 0)),
    CONSTRAINT "sessions_external_lecture_url_check" CHECK ((("external_lecture_url" IS NULL) OR ("length"("external_lecture_url") <= 2048))),
    CONSTRAINT "sessions_min_participants_check" CHECK (("min_participants" >= 1))
);


ALTER TABLE "public"."sessions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sessions"."booking_id" IS 'Optional anchor booking. Required for legacy 1:1 private sessions (every existing row has it set). NULL for halaqa sessions where enrollment is tracked in session_participants instead. Nullability relaxed in 2026-05-06 per Stage 5 prep.';



COMMENT ON COLUMN "public"."sessions"."lesson_plan" IS 'In-class checkpoint plan. JSONB: { checkpoints: [{id, label, completed_at?}], last_updated_at }. Drives the live progress chip in the student dashboard Online Classes widget and on /student/sessions/[id]. Optional — sessions without a plan render unchanged.';



COMMENT ON COLUMN "public"."sessions"."session_mode" IS 'Group-structure discriminator: private | halaqa | lecture. NOT to be confused with `session_type` (Quranic subject). Defaults to private; controls room creation mode + RLS path in Stage 2.';



COMMENT ON COLUMN "public"."sessions"."daily_room_mode" IS 'Daily.co room shape. ''default'' for private, ''group'' for halaqa, ''broadcast'' for lecture. Set by Stage 2 room creation service.';



COMMENT ON COLUMN "public"."sessions"."external_lecture_url" IS 'Optional external broadcast URL (typically YouTube Live, but any platform). Set when a session is being delivered via an external broadcast rather than via Daily.co. If non-null, the session detail page surfaces a "Watch live" link instead of the in-app video player. Stage 7 deferred path per FURQAN_SESSION_MODES_MIGRATION_PLAN.md.';



COMMENT ON COLUMN "public"."sessions"."scheduled_at" IS 'Direct scheduled time, used by halaqa sessions (which have NULL booking_id). Private sessions leave this NULL and continue to derive scheduled time from bookings.scheduled_at via the booking_id FK. Stage 5 form will set this when an admin creates a halaqa.';



CREATE TABLE IF NOT EXISTS "public"."site_announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_ar" "text" NOT NULL,
    "message_en" "text" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "is_dismissible" boolean DEFAULT true NOT NULL,
    "active_from" timestamp with time zone DEFAULT "now"() NOT NULL,
    "active_until" timestamp with time zone,
    "cta_label_ar" "text",
    "cta_label_en" "text",
    "cta_href" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "site_announcements_severity_check" CHECK (("severity" = ANY (ARRAY['info'::"text", 'warning'::"text", 'critical'::"text"])))
);


ALTER TABLE "public"."site_announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_blog_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" "text" NOT NULL,
    "label_ar" "text" NOT NULL,
    "label_en" "text" NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."site_blog_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_faqs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "question_ar" "text" NOT NULL,
    "question_en" "text" NOT NULL,
    "answer_ar" "text" NOT NULL,
    "answer_en" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."site_faqs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."site_features" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slot" "text" NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "icon_name" "text" NOT NULL,
    "title_ar" "text" NOT NULL,
    "title_en" "text" NOT NULL,
    "description_ar" "text",
    "description_en" "text",
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."site_features" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_credits" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "teacher_id" "uuid",
    "total" integer NOT NULL,
    "used" integer DEFAULT 0 NOT NULL,
    "credit_value_usd" numeric(10,2),
    "expires_at" timestamp with time zone,
    "source" "text" DEFAULT 'purchase'::"text" NOT NULL,
    "payment_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credits_used_check" CHECK (("used" <= "total")),
    CONSTRAINT "student_credits_source_check" CHECK (("source" = ANY (ARRAY['purchase'::"text", 'refund'::"text", 'gift'::"text", 'admin'::"text"]))),
    CONSTRAINT "student_credits_total_check" CHECK (("total" > 0))
);


ALTER TABLE "public"."student_credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_ijazah_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "pathway_id" "uuid" NOT NULL,
    "enrolled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "target_completion_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "issuing_teacher_id" "uuid",
    "issued_certificate_url" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."student_ijazah_progress" OWNER TO "postgres";


COMMENT ON TABLE "public"."student_ijazah_progress" IS 'A student enrolled in an ijazah pathway. Unique on (student_id, pathway_id).';



CREATE TABLE IF NOT EXISTS "public"."student_ijazah_requirement_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_progress_id" "uuid" NOT NULL,
    "requirement_id" "uuid" NOT NULL,
    "met_at" timestamp with time zone,
    "verifying_teacher_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."student_ijazah_requirement_progress" OWNER TO "postgres";


COMMENT ON TABLE "public"."student_ijazah_requirement_progress" IS 'Per-requirement tracking: which requirements has the student met, when, verified by which teacher.';



CREATE TABLE IF NOT EXISTS "public"."student_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "package_id" "uuid" NOT NULL,
    "payment_id" "uuid",
    "sessions_total" integer NOT NULL,
    "sessions_used" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "purchased_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sessions_remaining" integer GENERATED ALWAYS AS (("sessions_total" - "sessions_used")) STORED,
    "session_mode_used" "jsonb" DEFAULT '{"halaqa": 0, "lecture": 0, "private": 0}'::"jsonb" NOT NULL,
    "cancel_reason_code" "public"."booking_cancel_reason_code",
    "cancel_reason_detail" "text",
    CONSTRAINT "check_sessions_used" CHECK (("sessions_used" <= "sessions_total")),
    CONSTRAINT "student_packages_sessions_total_check" CHECK (("sessions_total" > 0)),
    CONSTRAINT "student_packages_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."student_packages" OWNER TO "postgres";


COMMENT ON COLUMN "public"."student_packages"."session_mode_used" IS 'Per-mode usage breakdown mirroring packages.session_mode_allowances. Aggregate sessions_used continues to be the canonical total counter.';



CREATE TABLE IF NOT EXISTS "public"."student_review_schedule" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "progress_id" "uuid" NOT NULL,
    "next_review_at" timestamp with time zone NOT NULL,
    "easiness_factor" real DEFAULT 2.5 NOT NULL,
    "interval_days" integer DEFAULT 1 NOT NULL,
    "lapse_count" smallint DEFAULT 0 NOT NULL,
    "last_reviewed_at" timestamp with time zone,
    "batch_for_date" "date",
    "algorithm_version" smallint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "student_review_schedule_easiness_factor_check" CHECK ((("easiness_factor" >= (1.3)::double precision) AND ("easiness_factor" <= (3.5)::double precision))),
    CONSTRAINT "student_review_schedule_interval_days_check" CHECK (("interval_days" >= 0))
);


ALTER TABLE "public"."student_review_schedule" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."study_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "ended_at" timestamp with time zone,
    "duration_seconds" integer DEFAULT 0 NOT NULL,
    "kind" "text" DEFAULT 'solo'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "study_log_kind_check" CHECK (("kind" = ANY (ARRAY['solo'::"text", 'review'::"text", 'dhikr'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."study_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."study_log" IS 'Self-reported study time entries (Time Tracker). One row per study session, manual or stopwatch. Joined with sessions.actual_duration for the Report Analytics chart.';



COMMENT ON COLUMN "public"."study_log"."kind" IS 'solo = independent memorization/practice; review = revising prior material; dhikr = remembrance; manual = generic time entry retroactively logged.';



CREATE TABLE IF NOT EXISTS "public"."teacher_availability" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "day_of_week" integer NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "slot_duration" integer DEFAULT 60 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    CONSTRAINT "avail_time_order" CHECK (("end_time" > "start_time")),
    CONSTRAINT "teacher_availability_day_of_week_check" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "teacher_availability_slot_duration_check" CHECK (("slot_duration" = ANY (ARRAY[30, 45, 60])))
);


ALTER TABLE "public"."teacher_availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_ijaza" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "riwaya" "text" NOT NULL,
    "chain_text" "text" NOT NULL,
    "granted_by" "text",
    "granted_at" "date",
    "document_url" "text",
    "verified_by" "uuid",
    "verified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "teacher_ijaza_riwaya_check" CHECK (("riwaya" = ANY (ARRAY['hafs'::"text", 'warsh'::"text", 'qalon'::"text", 'al_duri'::"text", 'shu_ba'::"text"])))
);


ALTER TABLE "public"."teacher_ijaza" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_languages" (
    "key" "text" NOT NULL,
    "label_ar" "text" NOT NULL,
    "label_en" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."teacher_languages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_mentorship_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentorship_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "feedback_text" "text" NOT NULL,
    "severity" "text" DEFAULT 'info'::"text" NOT NULL,
    "written_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "teacher_mentorship_feedback_severity_check" CHECK (("severity" = ANY (ARRAY['praise'::"text", 'info'::"text", 'suggestion'::"text", 'concern'::"text"])))
);


ALTER TABLE "public"."teacher_mentorship_feedback" OWNER TO "postgres";


COMMENT ON TABLE "public"."teacher_mentorship_feedback" IS 'Feedback the mentor writes about the mentee, optionally tied to a specific session_id they observed.';



CREATE TABLE IF NOT EXISTS "public"."teacher_mentorships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mentor_id" "uuid" NOT NULL,
    "mentee_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "teacher_mentorships_check" CHECK (("mentor_id" <> "mentee_id")),
    CONSTRAINT "teacher_mentorships_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'active'::"text", 'paused'::"text", 'ended'::"text"])))
);


ALTER TABLE "public"."teacher_mentorships" OWNER TO "postgres";


COMMENT ON TABLE "public"."teacher_mentorships" IS 'Teacher↔teacher mentor/mentee pairing. Both are teachers (profiles.role=teacher).';



CREATE TABLE IF NOT EXISTS "public"."teacher_profiles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "bio" "text",
    "specialties" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "recitation_standards" "text"[] DEFAULT '{hafs}'::"text"[] NOT NULL,
    "languages" "text"[] DEFAULT '{ar}'::"text"[] NOT NULL,
    "hourly_rate" numeric(10,2) NOT NULL,
    "gender" "public"."gender_type",
    "intro_video_url" "text",
    "max_active_students" integer,
    "rating_avg" numeric(3,2) DEFAULT 0 NOT NULL,
    "total_sessions" integer DEFAULT 0 NOT NULL,
    "is_accepting" boolean DEFAULT true NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cv_status" "public"."cv_status" DEFAULT 'draft'::"public"."cv_status" NOT NULL,
    "cv_reviewed_by" "uuid",
    "cv_reviewed_at" timestamp with time zone,
    "cv_rejection_reason" "text",
    "cv_submitted_at" timestamp with time zone,
    "bio_en" "text",
    CONSTRAINT "teacher_profiles_hourly_rate_check" CHECK ((("hourly_rate" >= (1)::numeric) AND ("hourly_rate" <= (500)::numeric))),
    CONSTRAINT "teacher_profiles_rating_avg_check" CHECK ((("rating_avg" >= (0)::numeric) AND ("rating_avg" <= (5)::numeric))),
    CONSTRAINT "teacher_profiles_recitation_standards_check" CHECK (("recitation_standards" <@ ARRAY['hafs'::"text", 'shu_ba'::"text", 'warsh'::"text", 'qalon'::"text", 'al_duri'::"text", 'al_duri_basri'::"text", 'al_susi'::"text", 'hisham'::"text", 'ibn_dhakwan'::"text", 'al_bazzi'::"text", 'qunbul'::"text", 'khalaf_hamzah'::"text", 'khallad'::"text"]))
);


ALTER TABLE "public"."teacher_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_recitations" (
    "key" "text" NOT NULL,
    "label_ar" "text" NOT NULL,
    "label_en" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."teacher_recitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_specialties" (
    "key" "text" NOT NULL,
    "label_ar" "text" NOT NULL,
    "label_en" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."teacher_specialties" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_bookings" WITH ("security_invoker"='true') AS
 SELECT "b"."id" AS "booking_id",
    "s"."full_name" AS "student_name",
    "t"."full_name" AS "teacher_name",
    "b"."scheduled_at",
    "b"."duration_min",
    "b"."status",
    "b"."session_type",
    "b"."notes",
    "b"."student_id",
    "b"."teacher_id",
    "b"."student_package_id",
    "b"."created_at"
   FROM (("public"."bookings" "b"
     LEFT JOIN "public"."profiles" "s" ON (("s"."id" = "b"."student_id")))
     LEFT JOIN "public"."profiles" "t" ON (("t"."id" = "b"."teacher_id")));


ALTER VIEW "public"."v_bookings" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_bookings" IS 'Browseable bookings — student + teacher names alongside booking detail.';



CREATE OR REPLACE VIEW "public"."v_evaluations" WITH ("security_invoker"='true') AS
 SELECT "ev"."id" AS "evaluation_id",
    "s"."full_name" AS "student_name",
    "t"."full_name" AS "teacher_name",
    "ev"."evaluation_type",
    "ev"."evaluation_date",
    "ev"."overall_score",
    "ev"."hifz_score",
    "ev"."tajweed_score",
    "ev"."fluency_score",
    "ev"."attendance_score",
    "ev"."strengths",
    "ev"."areas_for_improvement",
    "ev"."next_goals",
    "ev"."teacher_comments",
    "ev"."student_id",
    "ev"."teacher_id",
    "ev"."created_at"
   FROM (("public"."session_evaluations" "ev"
     LEFT JOIN "public"."profiles" "s" ON (("s"."id" = "ev"."student_id")))
     LEFT JOIN "public"."profiles" "t" ON (("t"."id" = "ev"."teacher_id")));


ALTER VIEW "public"."v_evaluations" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_evaluations" IS 'Browseable session evaluations — student/teacher names + scores.';



CREATE OR REPLACE VIEW "public"."v_homework" WITH ("security_invoker"='true') AS
 SELECT "h"."id" AS "homework_id",
    "s"."full_name" AS "student_name",
    "t"."full_name" AS "teacher_name",
    "h"."title",
    "h"."homework_type",
    "h"."status",
    "h"."due_date",
    "h"."surah_number",
    "h"."ayah_start",
    "h"."ayah_end",
    "h"."pages_count",
    "h"."teacher_notes",
    "h"."assigned_at",
    "h"."ready_at",
    "h"."completed_at",
    "h"."parent_assignment_id",
    "h"."student_id",
    "h"."teacher_id",
    "h"."booking_id",
    "h"."created_at"
   FROM (("public"."homework_assignments" "h"
     LEFT JOIN "public"."profiles" "s" ON (("s"."id" = "h"."student_id")))
     LEFT JOIN "public"."profiles" "t" ON (("t"."id" = "h"."teacher_id")));


ALTER VIEW "public"."v_homework" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_homework" IS 'Browseable homework assignments — adds student/teacher names.';



CREATE OR REPLACE VIEW "public"."v_package_effective_status" WITH ("security_invoker"='on') AS
 SELECT "id" AS "student_package_id",
    "student_id",
    "package_id",
    "payment_id",
    "sessions_total",
    "sessions_used",
    GREATEST(("sessions_total" - "sessions_used"), 0) AS "sessions_remaining",
    "expires_at",
    "purchased_at",
    "created_at",
        CASE
            WHEN (("expires_at" IS NOT NULL) AND ("expires_at" <= "now"())) THEN 'expired'::"text"
            WHEN ("sessions_used" >= "sessions_total") THEN 'exhausted'::"text"
            ELSE 'active'::"text"
        END AS "effective_status"
   FROM "public"."student_packages" "sp";


ALTER VIEW "public"."v_package_effective_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_progress" WITH ("security_invoker"='true') AS
 SELECT "sp"."id" AS "progress_id",
    "s"."full_name" AS "student_name",
    "t"."full_name" AS "teacher_name",
    "sp"."progress_type",
    "sp"."surah_from",
    "sp"."ayah_from",
    "sp"."surah_to",
    "sp"."ayah_to",
    "sp"."pages_reviewed",
    "sp"."quality_rating",
    "sp"."level",
    "sp"."teacher_notes",
    "sp"."student_id",
    "sp"."teacher_id",
    "sp"."booking_id",
    "sp"."created_at"
   FROM (("public"."student_progress" "sp"
     LEFT JOIN "public"."profiles" "s" ON (("s"."id" = "sp"."student_id")))
     LEFT JOIN "public"."profiles" "t" ON (("t"."id" = "sp"."teacher_id")));


ALTER VIEW "public"."v_progress" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_progress" IS 'Browseable student progress entries — adds student/teacher names.';



CREATE OR REPLACE VIEW "public"."v_sessions" WITH ("security_invoker"='true') AS
 SELECT "ses"."id" AS "session_id",
    "s"."full_name" AS "student_name",
    "t"."full_name" AS "teacher_name",
    "ses"."started_at",
    "ses"."ended_at",
    "ses"."actual_duration",
    "ses"."teacher_joined",
    "ses"."student_joined",
    "ses"."room_name",
    "ses"."room_url",
    "ses"."created_via",
    "ses"."is_observable",
    "ses"."booking_id",
    "ses"."created_at"
   FROM ((("public"."sessions" "ses"
     LEFT JOIN "public"."bookings" "b" ON (("b"."id" = "ses"."booking_id")))
     LEFT JOIN "public"."profiles" "s" ON (("s"."id" = "b"."student_id")))
     LEFT JOIN "public"."profiles" "t" ON (("t"."id" = "b"."teacher_id")));


ALTER VIEW "public"."v_sessions" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_sessions" IS 'Browseable sessions — derives student/teacher names through the booking.';



CREATE OR REPLACE VIEW "public"."v_student_packages" WITH ("security_invoker"='true') AS
 SELECT "sp"."id" AS "student_package_id",
    "s"."full_name" AS "student_name",
    "p"."name_ar" AS "package_name_ar",
    "p"."name" AS "package_name_en",
    "p"."package_type",
    "sp"."sessions_total",
    "sp"."sessions_used",
    "sp"."sessions_remaining",
    "sp"."status",
    "sp"."expires_at",
    "sp"."purchased_at",
    "sp"."student_id",
    "sp"."package_id",
    "sp"."payment_id",
    "sp"."created_at"
   FROM (("public"."student_packages" "sp"
     LEFT JOIN "public"."profiles" "s" ON (("s"."id" = "sp"."student_id")))
     LEFT JOIN "public"."packages" "p" ON (("p"."id" = "sp"."package_id")));


ALTER VIEW "public"."v_student_packages" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_student_packages" IS 'Browseable student packages — student name + package name + remaining count.';



CREATE OR REPLACE VIEW "public"."v_teachers" WITH ("security_invoker"='true') AS
 SELECT "tp"."teacher_id",
    "p"."full_name",
    "p"."full_name_ar",
    "p"."phone",
    "tp"."cv_status",
    "tp"."is_archived",
    "tp"."is_accepting",
    "tp"."hourly_rate",
    "tp"."rating_avg",
    "tp"."total_sessions",
    "tp"."specialties",
    "tp"."recitation_standards",
    "tp"."gender",
    "tp"."bio",
    "tp"."bio_en",
    "tp"."intro_video_url",
    "tp"."cv_reviewed_at",
    "tp"."created_at"
   FROM ("public"."teacher_profiles" "tp"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "tp"."teacher_id")));


ALTER VIEW "public"."v_teachers" OWNER TO "postgres";


COMMENT ON VIEW "public"."v_teachers" IS 'Browseable teacher list — joins teacher_profiles + profiles (incl. Arabic name). Read-only.';



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_dead_letter"
    ADD CONSTRAINT "automation_dead_letter_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_logs"
    ADD CONSTRAINT "automation_logs_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."automation_logs"
    ADD CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_availability"
    ADD CONSTRAINT "avail_unique" UNIQUE ("teacher_id", "day_of_week", "start_time");



ALTER TABLE ONLY "public"."availability_exceptions"
    ADD CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."class_offerings"
    ADD CONSTRAINT "class_offerings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communication_preferences"
    ADD CONSTRAINT "communication_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communication_preferences"
    ADD CONSTRAINT "communication_preferences_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."contact_submissions"
    ADD CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conv_unique" UNIQUE ("student_id", "teacher_id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_enrollments"
    ADD CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_enrollments"
    ADD CONSTRAINT "course_enrollments_student_id_course_id_key" UNIQUE ("student_id", "course_id");



ALTER TABLE ONLY "public"."course_lesson_progress"
    ADD CONSTRAINT "course_lesson_progress_enrollment_id_lesson_id_key" UNIQUE ("enrollment_id", "lesson_id");



ALTER TABLE ONLY "public"."course_lesson_progress"
    ADD CONSTRAINT "course_lesson_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_lessons"
    ADD CONSTRAINT "course_lessons_bunny_video_id_key" UNIQUE ("bunny_video_id");



ALTER TABLE ONLY "public"."course_lessons"
    ADD CONSTRAINT "course_lessons_course_id_order_index_key" UNIQUE ("course_id", "order_index");



ALTER TABLE ONLY "public"."course_lessons"
    ADD CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_payouts"
    ADD CONSTRAINT "course_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_payouts"
    ADD CONSTRAINT "course_payouts_teacher_id_period_start_period_end_currency_key" UNIQUE ("teacher_id", "period_start", "period_end", "currency");



ALTER TABLE ONLY "public"."course_reviews"
    ADD CONSTRAINT "course_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_reviews"
    ADD CONSTRAINT "course_reviews_student_id_course_id_key" UNIQUE ("student_id", "course_id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."daily_webhook_events"
    ADD CONSTRAINT "daily_webhook_events_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."forum_likes"
    ADD CONSTRAINT "forum_likes_pkey" PRIMARY KEY ("user_id", "target_type", "target_id");



ALTER TABLE ONLY "public"."forum_replies"
    ADD CONSTRAINT "forum_replies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forum_reports"
    ADD CONSTRAINT "forum_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forum_threads"
    ADD CONSTRAINT "forum_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."halaqa_waiting_list"
    ADD CONSTRAINT "halaqa_waiting_list_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."halaqa_waiting_list"
    ADD CONSTRAINT "halaqa_waiting_list_session_id_student_id_key" UNIQUE ("session_id", "student_id");



ALTER TABLE ONLY "public"."help_articles"
    ADD CONSTRAINT "help_articles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."help_articles"
    ADD CONSTRAINT "help_articles_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."help_categories"
    ADD CONSTRAINT "help_categories_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."homework_assignments"
    ADD CONSTRAINT "homework_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ijazah_pathways"
    ADD CONSTRAINT "ijazah_pathways_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ijazah_requirements"
    ADD CONSTRAINT "ijazah_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_number_key" UNIQUE ("invoice_number");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_payment_id_key" UNIQUE ("payment_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_document_versions"
    ADD CONSTRAINT "legal_document_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_documents"
    ADD CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("kind");



ALTER TABLE ONLY "public"."message_delivery_log"
    ADD CONSTRAINT "message_delivery_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."module_lessons"
    ADD CONSTRAINT "module_lessons_lesson_id_key" UNIQUE ("lesson_id");



ALTER TABLE ONLY "public"."module_lessons"
    ADD CONSTRAINT "module_lessons_pkey" PRIMARY KEY ("module_id", "lesson_id");



ALTER TABLE ONLY "public"."modules"
    ADD CONSTRAINT "modules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_broadcasts"
    ADD CONSTRAINT "notification_broadcasts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_package_type_key" UNIQUE ("package_type");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parent_reports"
    ADD CONSTRAINT "parent_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_stripe_id_key" UNIQUE ("stripe_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_paypal_capture_id_key" UNIQUE ("paypal_capture_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_paypal_order_id_key" UNIQUE ("paypal_order_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_stripe_payment_intent_key" UNIQUE ("stripe_payment_intent");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quiz_attempts"
    ADD CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quiz_question_keys"
    ADD CONSTRAINT "quiz_question_keys_pkey" PRIMARY KEY ("question_id");



ALTER TABLE ONLY "public"."quiz_questions"
    ADD CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quizzes"
    ADD CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quran_surahs"
    ADD CONSTRAINT "quran_surahs_pkey" PRIMARY KEY ("surah_num");



ALTER TABLE ONLY "public"."recitation_errors"
    ADD CONSTRAINT "recitation_errors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."refund_policies"
    ADD CONSTRAINT "refund_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."remote_handoff_tokens"
    ADD CONSTRAINT "remote_handoff_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resource_assignments"
    ADD CONSTRAINT "resource_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_signals"
    ADD CONSTRAINT "retention_signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."retention_signals"
    ADD CONSTRAINT "retention_signals_student_id_key" UNIQUE ("student_id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_evaluations"
    ADD CONSTRAINT "session_evaluations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_notes_history"
    ADD CONSTRAINT "session_notes_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_observers"
    ADD CONSTRAINT "session_observers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_session_id_user_id_key" UNIQUE ("session_id", "user_id");



ALTER TABLE ONLY "public"."session_presence_events"
    ADD CONSTRAINT "session_presence_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_booking_id_key" UNIQUE ("booking_id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_room_name_key" UNIQUE ("room_name");



ALTER TABLE ONLY "public"."site_announcements"
    ADD CONSTRAINT "site_announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_blog_categories"
    ADD CONSTRAINT "site_blog_categories_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."site_blog_categories"
    ADD CONSTRAINT "site_blog_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_faqs"
    ADD CONSTRAINT "site_faqs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_features"
    ADD CONSTRAINT "site_features_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_credits"
    ADD CONSTRAINT "student_credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_ijazah_progress"
    ADD CONSTRAINT "student_ijazah_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_ijazah_progress"
    ADD CONSTRAINT "student_ijazah_progress_student_id_pathway_id_key" UNIQUE ("student_id", "pathway_id");



ALTER TABLE ONLY "public"."student_ijazah_requirement_progress"
    ADD CONSTRAINT "student_ijazah_requirement_pr_student_progress_id_requireme_key" UNIQUE ("student_progress_id", "requirement_id");



ALTER TABLE ONLY "public"."student_ijazah_requirement_progress"
    ADD CONSTRAINT "student_ijazah_requirement_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_packages"
    ADD CONSTRAINT "student_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_review_schedule"
    ADD CONSTRAINT "student_review_schedule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_review_schedule"
    ADD CONSTRAINT "student_review_schedule_student_id_progress_id_key" UNIQUE ("student_id", "progress_id");



ALTER TABLE ONLY "public"."study_log"
    ADD CONSTRAINT "study_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_availability"
    ADD CONSTRAINT "teacher_availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_ijaza"
    ADD CONSTRAINT "teacher_ijaza_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_languages"
    ADD CONSTRAINT "teacher_languages_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."teacher_mentorship_feedback"
    ADD CONSTRAINT "teacher_mentorship_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_mentorships"
    ADD CONSTRAINT "teacher_mentorships_mentor_id_mentee_id_key" UNIQUE ("mentor_id", "mentee_id");



ALTER TABLE ONLY "public"."teacher_mentorships"
    ADD CONSTRAINT "teacher_mentorships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_profiles"
    ADD CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_profiles"
    ADD CONSTRAINT "teacher_profiles_teacher_id_key" UNIQUE ("teacher_id");



ALTER TABLE ONLY "public"."teacher_recitations"
    ADD CONSTRAINT "teacher_recitations_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."teacher_specialties"
    ADD CONSTRAINT "teacher_specialties_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "unique_progress_per_booking" UNIQUE ("student_id", "booking_id");



CREATE INDEX "blog_posts_cover_image_path_idx" ON "public"."blog_posts" USING "btree" ("cover_image_path") WHERE ("cover_image_path" IS NOT NULL);



CREATE INDEX "bookings_class_offering_id_idx" ON "public"."bookings" USING "btree" ("class_offering_id");



CREATE INDEX "bookings_session_id_idx" ON "public"."bookings" USING "btree" ("session_id");



CREATE UNIQUE INDEX "bookings_teacher_slot_unique_idx" ON "public"."bookings" USING "btree" ("teacher_id", "scheduled_at") WHERE ("status" <> 'cancelled'::"public"."booking_status");



CREATE INDEX "class_offerings_session_id_idx" ON "public"."class_offerings" USING "btree" ("session_id");



CREATE INDEX "class_offerings_status_scheduled_idx" ON "public"."class_offerings" USING "btree" ("status", "scheduled_at");



CREATE INDEX "class_offerings_teacher_id_idx" ON "public"."class_offerings" USING "btree" ("teacher_id");



CREATE INDEX "daily_webhook_events_received_at_idx" ON "public"."daily_webhook_events" USING "btree" ("received_at");



CREATE INDEX "forum_likes_target_idx" ON "public"."forum_likes" USING "btree" ("target_type", "target_id");



CREATE INDEX "forum_replies_author_id_idx" ON "public"."forum_replies" USING "btree" ("author_id");



CREATE INDEX "forum_replies_thread_idx" ON "public"."forum_replies" USING "btree" ("thread_id", "created_at");



CREATE INDEX "forum_reports_pending_idx" ON "public"."forum_reports" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "forum_reports_reporter_id_idx" ON "public"."forum_reports" USING "btree" ("reporter_id");



CREATE INDEX "forum_reports_resolved_by_idx" ON "public"."forum_reports" USING "btree" ("resolved_by");



CREATE INDEX "forum_threads_author_id_idx" ON "public"."forum_threads" USING "btree" ("author_id");



CREATE INDEX "forum_threads_pin_recent_idx" ON "public"."forum_threads" USING "btree" ("is_hidden", "is_pinned" DESC, "last_reply_at" DESC NULLS LAST, "created_at" DESC);



CREATE INDEX "help_articles_category_published_idx" ON "public"."help_articles" USING "btree" ("category", "is_published", "sort_order");



CREATE INDEX "help_articles_created_by_idx" ON "public"."help_articles" USING "btree" ("created_by");



CREATE INDEX "idx_audit_changed_by" ON "public"."audit_log" USING "btree" ("changed_by");



CREATE INDEX "idx_audit_log_auth_events" ON "public"."audit_log" USING "btree" ("changed_by", "created_at" DESC) WHERE ("action" = ANY (ARRAY['LOGIN'::"text", 'LOGOUT'::"text"]));



CREATE INDEX "idx_audit_log_created_at" ON "public"."audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_table" ON "public"."audit_log" USING "btree" ("table_name", "created_at" DESC);



CREATE INDEX "idx_audit_table_record" ON "public"."audit_log" USING "btree" ("table_name", "record_id");



CREATE INDEX "idx_automation_logs_entity" ON "public"."automation_logs" USING "btree" ("entity_id");



CREATE INDEX "idx_automation_logs_started" ON "public"."automation_logs" USING "btree" ("started_at" DESC);



CREATE INDEX "idx_automation_logs_workflow" ON "public"."automation_logs" USING "btree" ("workflow_name", "status");



CREATE INDEX "idx_avail_exceptions" ON "public"."availability_exceptions" USING "btree" ("teacher_id", "date");



CREATE INDEX "idx_bookings_active_student" ON "public"."bookings" USING "btree" ("student_id", "scheduled_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_bookings_active_teacher" ON "public"."bookings" USING "btree" ("teacher_id", "scheduled_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_bookings_cancelled_by" ON "public"."bookings" USING "btree" ("cancelled_by");



CREATE INDEX "idx_bookings_created_by" ON "public"."bookings" USING "btree" ("created_by");



CREATE INDEX "idx_bookings_refund_policy" ON "public"."bookings" USING "btree" ("refund_policy_id");



CREATE INDEX "idx_bookings_rescheduled_from" ON "public"."bookings" USING "btree" ("rescheduled_from");



CREATE INDEX "idx_bookings_status" ON "public"."bookings" USING "btree" ("status");



CREATE INDEX "idx_bookings_status_scheduled" ON "public"."bookings" USING "btree" ("status", "scheduled_at" DESC);



CREATE INDEX "idx_bookings_student" ON "public"."bookings" USING "btree" ("student_id");



CREATE INDEX "idx_bookings_student_package" ON "public"."bookings" USING "btree" ("student_package_id");



CREATE INDEX "idx_bookings_student_teacher" ON "public"."bookings" USING "btree" ("student_id", "teacher_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_bookings_teacher_sched" ON "public"."bookings" USING "btree" ("teacher_id", "scheduled_at") WHERE ("status" <> ALL (ARRAY['cancelled'::"public"."booking_status", 'no_show'::"public"."booking_status"]));



CREATE INDEX "idx_bookings_teacher_student" ON "public"."bookings" USING "btree" ("teacher_id", "student_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_conv_student" ON "public"."conversations" USING "btree" ("student_id", "last_message_at" DESC);



CREATE INDEX "idx_conversations_initiated_by" ON "public"."conversations" USING "btree" ("initiated_by");



CREATE INDEX "idx_conversations_student" ON "public"."conversations" USING "btree" ("student_id");



CREATE INDEX "idx_conversations_teacher" ON "public"."conversations" USING "btree" ("teacher_id");



CREATE INDEX "idx_course_enrollments_course_id" ON "public"."course_enrollments" USING "btree" ("course_id");



CREATE INDEX "idx_course_enrollments_payment_id" ON "public"."course_enrollments" USING "btree" ("payment_id");



CREATE INDEX "idx_course_enrollments_student_id" ON "public"."course_enrollments" USING "btree" ("student_id", "enrolled_at" DESC);



CREATE INDEX "idx_course_lesson_progress_lesson_id" ON "public"."course_lesson_progress" USING "btree" ("lesson_id");



CREATE INDEX "idx_course_lessons_course_id" ON "public"."course_lessons" USING "btree" ("course_id", "order_index");



CREATE INDEX "idx_course_lessons_video_status" ON "public"."course_lessons" USING "btree" ("video_status") WHERE ("video_status" = ANY (ARRAY['uploading'::"text", 'processing'::"text"]));



CREATE INDEX "idx_course_payouts_status" ON "public"."course_payouts" USING "btree" ("status") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_course_payouts_teacher_id" ON "public"."course_payouts" USING "btree" ("teacher_id", "status", "period_end" DESC);



CREATE INDEX "idx_course_reviews_course_id" ON "public"."course_reviews" USING "btree" ("course_id", "status", "created_at" DESC);



CREATE INDEX "idx_course_reviews_enrollment_id" ON "public"."course_reviews" USING "btree" ("enrollment_id");



CREATE INDEX "idx_course_reviews_student_id" ON "public"."course_reviews" USING "btree" ("student_id");



CREATE INDEX "idx_courses_platform_owned" ON "public"."courses" USING "btree" ("status", "published_at" DESC) WHERE (("ownership" = 'platform'::"text") AND ("deleted_at" IS NULL));



CREATE INDEX "idx_courses_reviewed_by" ON "public"."courses" USING "btree" ("reviewed_by");



CREATE INDEX "idx_courses_specialty" ON "public"."courses" USING "btree" ("specialty") WHERE ("status" = 'published'::"text");



CREATE INDEX "idx_courses_status_published_at" ON "public"."courses" USING "btree" ("status", "published_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_courses_teacher_id" ON "public"."courses" USING "btree" ("teacher_id", "status");



CREATE INDEX "idx_credits_available" ON "public"."student_credits" USING "btree" ("student_id", "teacher_id", "expires_at") WHERE ("used" < "total");



CREATE INDEX "idx_credits_student" ON "public"."student_credits" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "idx_dead_letter_entity" ON "public"."automation_dead_letter" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_dead_letter_resolved_by" ON "public"."automation_dead_letter" USING "btree" ("resolved_by");



CREATE INDEX "idx_dead_letter_unresolved" ON "public"."automation_dead_letter" USING "btree" ("last_failed_at" DESC) WHERE ("resolved_at" IS NULL);



CREATE INDEX "idx_dead_letter_workflow" ON "public"."automation_dead_letter" USING "btree" ("workflow_name");



CREATE INDEX "idx_delivery_log_entity" ON "public"."message_delivery_log" USING "btree" ("related_entity_id");



CREATE INDEX "idx_delivery_log_recipient" ON "public"."message_delivery_log" USING "btree" ("recipient_user_id", "created_at" DESC);



CREATE INDEX "idx_delivery_log_status" ON "public"."message_delivery_log" USING "btree" ("status");



CREATE INDEX "idx_errors_progress" ON "public"."recitation_errors" USING "btree" ("progress_id");



CREATE INDEX "idx_eval_flagged" ON "public"."session_evaluations" USING "btree" ("overall_score", "created_at" DESC) WHERE (("overall_score" IS NOT NULL) AND ("overall_score" <= 3));



CREATE INDEX "idx_eval_student" ON "public"."session_evaluations" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "idx_eval_teacher" ON "public"."session_evaluations" USING "btree" ("teacher_id", "created_at" DESC);



CREATE INDEX "idx_eval_teacher_evaldate" ON "public"."session_evaluations" USING "btree" ("teacher_id", "evaluation_date" DESC);



CREATE INDEX "idx_halaqa_waiting_list_session_position" ON "public"."halaqa_waiting_list" USING "btree" ("session_id", "position");



CREATE INDEX "idx_halaqa_waiting_list_student" ON "public"."halaqa_waiting_list" USING "btree" ("student_id");



CREATE INDEX "idx_homework_booking" ON "public"."homework_assignments" USING "btree" ("booking_id");



CREATE INDEX "idx_homework_parent" ON "public"."homework_assignments" USING "btree" ("parent_assignment_id");



CREATE INDEX "idx_homework_session" ON "public"."homework_assignments" USING "btree" ("session_id");



CREATE INDEX "idx_homework_student_all" ON "public"."homework_assignments" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "idx_homework_student_horizon" ON "public"."homework_assignments" USING "btree" ("student_id", "review_horizon", "status") WHERE ("review_horizon" = ANY (ARRAY['near'::"text", 'far'::"text"]));



CREATE INDEX "idx_homework_student_status" ON "public"."homework_assignments" USING "btree" ("student_id", "status");



CREATE INDEX "idx_homework_teacher_status" ON "public"."homework_assignments" USING "btree" ("teacher_id", "status");



CREATE INDEX "idx_invoices_student" ON "public"."invoices" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "idx_legal_document_versions_saved_by" ON "public"."legal_document_versions" USING "btree" ("saved_by");



CREATE INDEX "idx_messages_active" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "idx_messages_flagged_by" ON "public"."messages" USING "btree" ("flagged_by");



CREATE INDEX "idx_messages_flagged_open" ON "public"."messages" USING "btree" ("flagged_at" DESC) WHERE (("flagged_at" IS NOT NULL) AND ("hidden_at" IS NULL));



CREATE INDEX "idx_messages_hidden_by" ON "public"."messages" USING "btree" ("hidden_by");



CREATE INDEX "idx_messages_sender" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_notes_history_session" ON "public"."session_notes_history" USING "btree" ("session_id", "created_at" DESC);



CREATE INDEX "idx_notifications_expired" ON "public"."notifications" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "is_read", "created_at" DESC);



CREATE INDEX "idx_observers_session" ON "public"."session_observers" USING "btree" ("session_id");



CREATE INDEX "idx_packages_active" ON "public"."packages" USING "btree" ("is_active", "display_order");



CREATE INDEX "idx_parent_reports_student" ON "public"."parent_reports" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "idx_parent_reports_teacher" ON "public"."parent_reports" USING "btree" ("teacher_id");



CREATE INDEX "idx_payment_transactions_payment" ON "public"."payment_transactions" USING "btree" ("payment_id");



CREATE INDEX "idx_payments_package" ON "public"."payments" USING "btree" ("package_id");



CREATE INDEX "idx_payments_paypal_order" ON "public"."payments" USING "btree" ("paypal_order_id");



CREATE INDEX "idx_payments_provider" ON "public"."payments" USING "btree" ("provider");



CREATE INDEX "idx_payments_status" ON "public"."payments" USING "btree" ("status");



CREATE INDEX "idx_payments_student" ON "public"."payments" USING "btree" ("student_id");



CREATE INDEX "idx_platform_settings_updated_by" ON "public"."platform_settings" USING "btree" ("updated_by");



CREATE INDEX "idx_presence_session" ON "public"."session_presence_events" USING "btree" ("session_id", "occurred_at");



CREATE INDEX "idx_presence_user" ON "public"."session_presence_events" USING "btree" ("user_id", "occurred_at" DESC);



CREATE INDEX "idx_profiles_active" ON "public"."profiles" USING "btree" ("role") WHERE (("deleted_at" IS NULL) AND ("is_active" = true));



CREATE INDEX "idx_progress_student" ON "public"."student_progress" USING "btree" ("student_id", "created_at" DESC);



CREATE INDEX "idx_progress_teacher" ON "public"."student_progress" USING "btree" ("teacher_id");



CREATE INDEX "idx_recitation_errors" ON "public"."recitation_errors" USING "btree" ("progress_id", "resolved");



CREATE INDEX "idx_remote_handoff_admin_active" ON "public"."remote_handoff_tokens" USING "btree" ("admin_user_id", "expires_at") WHERE ("used_at" IS NULL);



CREATE INDEX "idx_remote_handoff_cleanup" ON "public"."remote_handoff_tokens" USING "btree" ("expires_at") WHERE ("used_at" IS NULL);



CREATE UNIQUE INDEX "idx_remote_handoff_code_hash" ON "public"."remote_handoff_tokens" USING "btree" ("code_hash");



CREATE INDEX "idx_retention_churn" ON "public"."retention_signals" USING "btree" ("churn_risk_score" DESC);



CREATE INDEX "idx_retention_signals_risk" ON "public"."retention_signals" USING "btree" ("churn_risk_score" DESC, "student_id");



CREATE INDEX "idx_retention_student" ON "public"."retention_signals" USING "btree" ("student_id");



CREATE INDEX "idx_reviews_student" ON "public"."reviews" USING "btree" ("student_id");



CREATE INDEX "idx_reviews_teacher" ON "public"."reviews" USING "btree" ("teacher_id", "created_at" DESC);



CREATE INDEX "idx_session_notes_saved_by" ON "public"."session_notes_history" USING "btree" ("saved_by");



CREATE INDEX "idx_session_observers_observer_id" ON "public"."session_observers" USING "btree" ("observer_id");



CREATE INDEX "idx_session_participants_role" ON "public"."session_participants" USING "btree" ("role");



CREATE INDEX "idx_session_participants_session" ON "public"."session_participants" USING "btree" ("session_id");



CREATE INDEX "idx_session_participants_user" ON "public"."session_participants" USING "btree" ("user_id");



CREATE INDEX "idx_sessions_admin_observer_id" ON "public"."sessions" USING "btree" ("admin_observer_id");



CREATE INDEX "idx_sessions_booking_id" ON "public"."sessions" USING "btree" ("booking_id");



CREATE INDEX "idx_sessions_live" ON "public"."sessions" USING "btree" ("booking_id") WHERE (("started_at" IS NOT NULL) AND ("ended_at" IS NULL));



CREATE INDEX "idx_sessions_scheduled_at" ON "public"."sessions" USING "btree" ("scheduled_at") WHERE ("scheduled_at" IS NOT NULL);



CREATE INDEX "idx_sessions_session_mode" ON "public"."sessions" USING "btree" ("session_mode");



CREATE INDEX "idx_sessions_started_at" ON "public"."sessions" USING "btree" ("started_at" DESC);



CREATE INDEX "idx_site_announcements_active" ON "public"."site_announcements" USING "btree" ("active_from" DESC, "active_until" DESC);



CREATE INDEX "idx_site_announcements_created_by" ON "public"."site_announcements" USING "btree" ("created_by");



CREATE INDEX "idx_srs__batch_for_date" ON "public"."student_review_schedule" USING "btree" ("batch_for_date") WHERE ("batch_for_date" IS NOT NULL);



CREATE INDEX "idx_srs__student_next_review" ON "public"."student_review_schedule" USING "btree" ("student_id", "next_review_at");



CREATE INDEX "idx_student_credits_payment_id" ON "public"."student_credits" USING "btree" ("payment_id");



CREATE INDEX "idx_student_credits_teacher_id" ON "public"."student_credits" USING "btree" ("teacher_id");



CREATE INDEX "idx_student_packages_low_balance" ON "public"."student_packages" USING "btree" ("sessions_remaining") WHERE (("status" = 'active'::"text") AND ("sessions_remaining" <= 2));



CREATE INDEX "idx_student_packages_package_id" ON "public"."student_packages" USING "btree" ("package_id");



CREATE INDEX "idx_student_packages_payment_id" ON "public"."student_packages" USING "btree" ("payment_id");



CREATE INDEX "idx_student_packages_status" ON "public"."student_packages" USING "btree" ("status");



CREATE INDEX "idx_student_packages_student" ON "public"."student_packages" USING "btree" ("student_id", "status");



CREATE INDEX "idx_student_progress_booking_id" ON "public"."student_progress" USING "btree" ("booking_id");



CREATE INDEX "idx_teacher_cv_pending" ON "public"."teacher_profiles" USING "btree" ("created_at" DESC) WHERE ("cv_status" = 'pending_review'::"public"."cv_status");



CREATE INDEX "idx_teacher_ijaza_teacher" ON "public"."teacher_ijaza" USING "btree" ("teacher_id");



CREATE INDEX "idx_teacher_ijaza_verified_by" ON "public"."teacher_ijaza" USING "btree" ("verified_by");



CREATE INDEX "idx_teacher_profiles_cv_reviewed_by" ON "public"."teacher_profiles" USING "btree" ("cv_reviewed_by");



CREATE INDEX "ijazah_pathways_active_idx" ON "public"."ijazah_pathways" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "ijazah_requirements_pathway_idx" ON "public"."ijazah_requirements" USING "btree" ("pathway_id", "sequence");



CREATE INDEX "legal_versions_kind_version_idx" ON "public"."legal_document_versions" USING "btree" ("kind", "version" DESC);



CREATE INDEX "module_lessons_lookup_idx" ON "public"."module_lessons" USING "btree" ("module_id", "sort_order");



CREATE INDEX "modules_course_sort_idx" ON "public"."modules" USING "btree" ("course_id", "sort_order");



CREATE INDEX "notification_broadcasts_pending_idx" ON "public"."notification_broadcasts" USING "btree" ("created_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text"]));



CREATE INDEX "profiles_roles_gin" ON "public"."profiles" USING "gin" ("roles");



CREATE INDEX "quiz_attempts_student_quiz_idx" ON "public"."quiz_attempts" USING "btree" ("student_id", "quiz_id", "submitted_at" DESC);



CREATE INDEX "quiz_questions_quiz_sort_idx" ON "public"."quiz_questions" USING "btree" ("quiz_id", "sort_order");



CREATE INDEX "quizzes_course_pub_idx" ON "public"."quizzes" USING "btree" ("course_id", "is_published");



CREATE INDEX "quizzes_created_by_idx" ON "public"."quizzes" USING "btree" ("created_by");



CREATE INDEX "quizzes_lesson_id_idx" ON "public"."quizzes" USING "btree" ("lesson_id");



CREATE INDEX "resource_assignments_halaqa_lookup_idx" ON "public"."resource_assignments" USING "btree" ("halaqa_id", "created_at" DESC) WHERE ("halaqa_id" IS NOT NULL);



CREATE INDEX "resource_assignments_resource_idx" ON "public"."resource_assignments" USING "btree" ("resource_id");



CREATE INDEX "resource_assignments_student_lookup_idx" ON "public"."resource_assignments" USING "btree" ("student_id", "created_at" DESC) WHERE ("student_id" IS NOT NULL);



CREATE UNIQUE INDEX "resource_assignments_unique_halaqa_idx" ON "public"."resource_assignments" USING "btree" ("resource_id", "halaqa_id") WHERE ("halaqa_id" IS NOT NULL);



CREATE UNIQUE INDEX "resource_assignments_unique_student_idx" ON "public"."resource_assignments" USING "btree" ("resource_id", "student_id") WHERE ("student_id" IS NOT NULL);



CREATE INDEX "resources_published_type_idx" ON "public"."resources" USING "btree" ("is_published", "resource_type", "category");



CREATE INDEX "resources_teacher_owner_idx" ON "public"."resources" USING "btree" ("created_by_teacher_id") WHERE ("created_by_teacher_id" IS NOT NULL);



CREATE INDEX "resources_uploaded_by_idx" ON "public"."resources" USING "btree" ("uploaded_by");



CREATE UNIQUE INDEX "sessions_room_name_unique_idx" ON "public"."sessions" USING "btree" ("room_name") WHERE ("room_name" IS NOT NULL);



CREATE INDEX "site_blog_categories_active_order" ON "public"."site_blog_categories" USING "btree" ("is_active", "sort_order");



CREATE INDEX "site_faqs_active_order" ON "public"."site_faqs" USING "btree" ("is_active", "sort_order");



CREATE INDEX "site_features_slot_active_order" ON "public"."site_features" USING "btree" ("slot", "is_active", "sort_order");



CREATE INDEX "student_ijazah_progress_completed_idx" ON "public"."student_ijazah_progress" USING "btree" ("completed_at") WHERE ("completed_at" IS NOT NULL);



CREATE INDEX "student_ijazah_progress_student_idx" ON "public"."student_ijazah_progress" USING "btree" ("student_id");



CREATE INDEX "student_ijazah_req_progress_pathway_idx" ON "public"."student_ijazah_requirement_progress" USING "btree" ("student_progress_id");



CREATE INDEX "study_log_student_started_idx" ON "public"."study_log" USING "btree" ("student_id", "started_at" DESC);



CREATE INDEX "teacher_mentorship_feedback_mentorship_idx" ON "public"."teacher_mentorship_feedback" USING "btree" ("mentorship_id", "created_at" DESC);



CREATE INDEX "teacher_mentorships_mentee_idx" ON "public"."teacher_mentorships" USING "btree" ("mentee_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "teacher_mentorships_mentor_idx" ON "public"."teacher_mentorships" USING "btree" ("mentor_id") WHERE ("status" = 'active'::"text");



CREATE OR REPLACE TRIGGER "blog_posts_updated_at" BEFORE UPDATE ON "public"."blog_posts" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "check_homework_chain_depth" BEFORE INSERT OR UPDATE OF "parent_assignment_id" ON "public"."homework_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."check_homework_chain_depth"();



CREATE OR REPLACE TRIGGER "class_offerings_set_updated_at" BEFORE UPDATE ON "public"."class_offerings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "course_lesson_progress_updated_at" BEFORE UPDATE ON "public"."course_lesson_progress" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "course_lessons_updated_at" BEFORE UPDATE ON "public"."course_lessons" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "course_payouts_updated_at" BEFORE UPDATE ON "public"."course_payouts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "course_reviews_aggregate_trigger" AFTER INSERT OR DELETE OR UPDATE ON "public"."course_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."tr_course_reviews_aggregate"();



CREATE OR REPLACE TRIGGER "course_reviews_updated_at" BEFORE UPDATE ON "public"."course_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "courses_updated_at" BEFORE UPDATE ON "public"."courses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "enforce_homework_update_rules" BEFORE UPDATE ON "public"."homework_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_homework_update_rules"();



CREATE OR REPLACE TRIGGER "forum_replies_after_delete" AFTER DELETE ON "public"."forum_replies" FOR EACH ROW EXECUTE FUNCTION "public"."fn_forum_replies_after_delete"();



CREATE OR REPLACE TRIGGER "forum_replies_after_insert" AFTER INSERT ON "public"."forum_replies" FOR EACH ROW EXECUTE FUNCTION "public"."fn_forum_replies_after_insert"();



CREATE OR REPLACE TRIGGER "forum_replies_set_updated_at" BEFORE UPDATE ON "public"."forum_replies" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "forum_threads_set_updated_at" BEFORE UPDATE ON "public"."forum_threads" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "help_articles_set_updated_at" BEFORE UPDATE ON "public"."help_articles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "modules_set_updated_at" BEFORE UPDATE ON "public"."modules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "quiz_question_keys_set_updated_at" BEFORE UPDATE ON "public"."quiz_question_keys" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "quizzes_set_updated_at" BEFORE UPDATE ON "public"."quizzes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "resources_set_updated_at" BEFORE UPDATE ON "public"."resources" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_session_participants_updated_at" BEFORE UPDATE ON "public"."session_participants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "site_blog_categories_set_updated_at" BEFORE UPDATE ON "public"."site_blog_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "site_faqs_set_updated_at" BEFORE UPDATE ON "public"."site_faqs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "site_features_set_updated_at" BEFORE UPDATE ON "public"."site_features" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "study_log_set_updated_at" BEFORE UPDATE ON "public"."study_log" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_audit_log_redact" BEFORE INSERT ON "public"."audit_log" FOR EACH ROW EXECUTE FUNCTION "public"."audit_log_redact_pii_trigger"();



CREATE OR REPLACE TRIGGER "t_blog_posts_upd" BEFORE UPDATE ON "public"."blog_posts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_calc_actual_duration" BEFORE INSERT OR UPDATE ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."calc_actual_duration"();



CREATE OR REPLACE TRIGGER "t_comm_prefs_upd" BEFORE UPDATE ON "public"."communication_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_deduct_student_credit" AFTER UPDATE ON "public"."bookings" FOR EACH ROW WHEN ((("new"."status" = 'confirmed'::"public"."booking_status") AND ("old"."status" = 'pending'::"public"."booking_status"))) EXECUTE FUNCTION "public"."deduct_student_credit"();



CREATE OR REPLACE TRIGGER "t_deduct_student_package" AFTER UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."deduct_student_package"();



CREATE OR REPLACE TRIGGER "t_ensure_teacher_profile" AFTER INSERT OR UPDATE OF "role" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "private"."ensure_teacher_profile"();



CREATE OR REPLACE TRIGGER "t_gen_invoice_number" BEFORE INSERT ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "public"."gen_invoice_number"();



CREATE OR REPLACE TRIGGER "t_gen_room_name" BEFORE INSERT ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."gen_room_name"();



CREATE OR REPLACE TRIGGER "t_guard_session" BEFORE INSERT ON "public"."sessions" FOR EACH ROW EXECUTE FUNCTION "public"."guard_session"();



CREATE OR REPLACE TRIGGER "t_homework_assignments_upd" BEFORE UPDATE ON "public"."homework_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_inc_teacher_sessions" AFTER UPDATE ON "public"."bookings" FOR EACH ROW WHEN ((("new"."status" = 'completed'::"public"."booking_status") AND ("old"."status" <> 'completed'::"public"."booking_status"))) EXECUTE FUNCTION "public"."inc_teacher_sessions"();



CREATE OR REPLACE TRIGGER "t_lock_confirmed_fields" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."lock_confirmed_fields"();



CREATE OR REPLACE TRIGGER "t_lock_rate_snapshot" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."lock_rate_snapshot"();



CREATE OR REPLACE TRIGGER "t_lock_refund_policy" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."lock_refund_policy"();



CREATE OR REPLACE TRIGGER "t_packages_upd" BEFORE UPDATE ON "public"."packages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_profiles_upd" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_restore_student_credit" AFTER UPDATE ON "public"."bookings" FOR EACH ROW WHEN ((("new"."status" = 'cancelled'::"public"."booking_status") AND ("old"."status" = 'confirmed'::"public"."booking_status"))) EXECUTE FUNCTION "public"."restore_student_credit"();



CREATE OR REPLACE TRIGGER "t_restore_student_package" AFTER UPDATE OF "status" ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."restore_student_package"();



CREATE OR REPLACE TRIGGER "t_services_upd" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_session_evaluations_upd" BEFORE UPDATE ON "public"."session_evaluations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_set_cancelled_at" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."set_cancelled_at"();



CREATE OR REPLACE TRIGGER "t_site_announcements_updated" BEFORE UPDATE ON "public"."site_announcements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_sync_conv_ts" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."sync_conv_ts"();



CREATE OR REPLACE TRIGGER "t_sync_teacher_archive" AFTER UPDATE OF "deleted_at" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "private"."sync_teacher_archive_with_profile"();



CREATE OR REPLACE TRIGGER "t_tp_upd" BEFORE UPDATE ON "public"."teacher_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "t_update_teacher_rating" AFTER INSERT OR DELETE OR UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."update_teacher_rating"();



CREATE OR REPLACE TRIGGER "t_validate_booking_status" BEFORE UPDATE ON "public"."bookings" FOR EACH ROW WHEN (("old"."status" IS DISTINCT FROM "new"."status")) EXECUTE FUNCTION "public"."validate_booking_status"();



CREATE OR REPLACE TRIGGER "t_validate_credits_total" BEFORE UPDATE ON "public"."student_credits" FOR EACH ROW EXECUTE FUNCTION "public"."validate_credits_total"();



CREATE OR REPLACE TRIGGER "t_validate_session_type" BEFORE INSERT OR UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."validate_session_type"();



CREATE OR REPLACE TRIGGER "t_validate_student_progress_range" BEFORE INSERT OR UPDATE OF "surah_from", "ayah_from", "surah_to", "ayah_to" ON "public"."student_progress" FOR EACH ROW EXECUTE FUNCTION "public"."validate_student_progress_range"();



CREATE OR REPLACE TRIGGER "trg_srs__set_updated_at" BEFORE UPDATE ON "public"."student_review_schedule" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."automation_dead_letter"
    ADD CONSTRAINT "automation_dead_letter_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."availability_exceptions"
    ADD CONSTRAINT "availability_exceptions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_class_offering_id_fkey" FOREIGN KEY ("class_offering_id") REFERENCES "public"."class_offerings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_refund_policy_id_fkey" FOREIGN KEY ("refund_policy_id") REFERENCES "public"."refund_policies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_rescheduled_from_fkey" FOREIGN KEY ("rescheduled_from") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_student_package_id_fkey" FOREIGN KEY ("student_package_id") REFERENCES "public"."student_packages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."class_offerings"
    ADD CONSTRAINT "class_offerings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."class_offerings"
    ADD CONSTRAINT "class_offerings_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."communication_preferences"
    ADD CONSTRAINT "communication_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."course_enrollments"
    ADD CONSTRAINT "course_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."course_enrollments"
    ADD CONSTRAINT "course_enrollments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."course_enrollments"
    ADD CONSTRAINT "course_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_lesson_progress"
    ADD CONSTRAINT "course_lesson_progress_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "public"."course_enrollments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_lesson_progress"
    ADD CONSTRAINT "course_lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."course_lessons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_lessons"
    ADD CONSTRAINT "course_lessons_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_payouts"
    ADD CONSTRAINT "course_payouts_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."course_reviews"
    ADD CONSTRAINT "course_reviews_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_reviews"
    ADD CONSTRAINT "course_reviews_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "public"."course_enrollments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_reviews"
    ADD CONSTRAINT "course_reviews_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."daily_webhook_events"
    ADD CONSTRAINT "daily_webhook_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "fk_payments_booking" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."forum_likes"
    ADD CONSTRAINT "forum_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_replies"
    ADD CONSTRAINT "forum_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_replies"
    ADD CONSTRAINT "forum_replies_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."forum_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_reports"
    ADD CONSTRAINT "forum_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forum_reports"
    ADD CONSTRAINT "forum_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forum_threads"
    ADD CONSTRAINT "forum_threads_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."halaqa_waiting_list"
    ADD CONSTRAINT "halaqa_waiting_list_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."halaqa_waiting_list"
    ADD CONSTRAINT "halaqa_waiting_list_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."help_articles"
    ADD CONSTRAINT "help_articles_category_fkey" FOREIGN KEY ("category") REFERENCES "public"."help_categories"("slug") ON UPDATE CASCADE;



ALTER TABLE ONLY "public"."help_articles"
    ADD CONSTRAINT "help_articles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."homework_assignments"
    ADD CONSTRAINT "homework_assignments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id");



ALTER TABLE ONLY "public"."homework_assignments"
    ADD CONSTRAINT "homework_assignments_parent_assignment_id_fkey" FOREIGN KEY ("parent_assignment_id") REFERENCES "public"."homework_assignments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."homework_assignments"
    ADD CONSTRAINT "homework_assignments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id");



ALTER TABLE ONLY "public"."homework_assignments"
    ADD CONSTRAINT "homework_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."homework_assignments"
    ADD CONSTRAINT "homework_assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."ijazah_requirements"
    ADD CONSTRAINT "ijazah_requirements_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."ijazah_pathways"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."legal_document_versions"
    ADD CONSTRAINT "legal_document_versions_saved_by_fkey" FOREIGN KEY ("saved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."message_delivery_log"
    ADD CONSTRAINT "message_delivery_log_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_flagged_by_fkey" FOREIGN KEY ("flagged_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_hidden_by_fkey" FOREIGN KEY ("hidden_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."module_lessons"
    ADD CONSTRAINT "module_lessons_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."course_lessons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."module_lessons"
    ADD CONSTRAINT "module_lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."modules"
    ADD CONSTRAINT "modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_broadcasts"
    ADD CONSTRAINT "notification_broadcasts_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parent_reports"
    ADD CONSTRAINT "parent_reports_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parent_reports"
    ADD CONSTRAINT "parent_reports_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_transactions"
    ADD CONSTRAINT "payment_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quiz_attempts"
    ADD CONSTRAINT "quiz_attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quiz_attempts"
    ADD CONSTRAINT "quiz_attempts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quiz_question_keys"
    ADD CONSTRAINT "quiz_question_keys_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."quiz_questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quiz_questions"
    ADD CONSTRAINT "quiz_questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quizzes"
    ADD CONSTRAINT "quizzes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quizzes"
    ADD CONSTRAINT "quizzes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."quizzes"
    ADD CONSTRAINT "quizzes_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."course_lessons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recitation_errors"
    ADD CONSTRAINT "recitation_errors_progress_id_fkey" FOREIGN KEY ("progress_id") REFERENCES "public"."student_progress"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."remote_handoff_tokens"
    ADD CONSTRAINT "remote_handoff_tokens_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resource_assignments"
    ADD CONSTRAINT "resource_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resource_assignments"
    ADD CONSTRAINT "resource_assignments_halaqa_id_fkey" FOREIGN KEY ("halaqa_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resource_assignments"
    ADD CONSTRAINT "resource_assignments_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resource_assignments"
    ADD CONSTRAINT "resource_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_created_by_teacher_id_fkey" FOREIGN KEY ("created_by_teacher_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."retention_signals"
    ADD CONSTRAINT "retention_signals_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."session_evaluations"
    ADD CONSTRAINT "session_evaluations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_evaluations"
    ADD CONSTRAINT "session_evaluations_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_notes_history"
    ADD CONSTRAINT "session_notes_history_saved_by_fkey" FOREIGN KEY ("saved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."session_notes_history"
    ADD CONSTRAINT "session_notes_history_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id");



ALTER TABLE ONLY "public"."session_observers"
    ADD CONSTRAINT "session_observers_observer_id_fkey" FOREIGN KEY ("observer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."session_observers"
    ADD CONSTRAINT "session_observers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id");



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_participants"
    ADD CONSTRAINT "session_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_presence_events"
    ADD CONSTRAINT "session_presence_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_presence_events"
    ADD CONSTRAINT "session_presence_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_admin_observer_id_fkey" FOREIGN KEY ("admin_observer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sessions"
    ADD CONSTRAINT "sessions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."site_announcements"
    ADD CONSTRAINT "site_announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."student_credits"
    ADD CONSTRAINT "student_credits_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_credits"
    ADD CONSTRAINT "student_credits_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_credits"
    ADD CONSTRAINT "student_credits_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_ijazah_progress"
    ADD CONSTRAINT "student_ijazah_progress_issuing_teacher_id_fkey" FOREIGN KEY ("issuing_teacher_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."student_ijazah_progress"
    ADD CONSTRAINT "student_ijazah_progress_pathway_id_fkey" FOREIGN KEY ("pathway_id") REFERENCES "public"."ijazah_pathways"("id");



ALTER TABLE ONLY "public"."student_ijazah_progress"
    ADD CONSTRAINT "student_ijazah_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_ijazah_requirement_progress"
    ADD CONSTRAINT "student_ijazah_requirement_progress_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."ijazah_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_ijazah_requirement_progress"
    ADD CONSTRAINT "student_ijazah_requirement_progress_student_progress_id_fkey" FOREIGN KEY ("student_progress_id") REFERENCES "public"."student_ijazah_progress"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_ijazah_requirement_progress"
    ADD CONSTRAINT "student_ijazah_requirement_progress_verifying_teacher_id_fkey" FOREIGN KEY ("verifying_teacher_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."student_packages"
    ADD CONSTRAINT "student_packages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_packages"
    ADD CONSTRAINT "student_packages_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_packages"
    ADD CONSTRAINT "student_packages_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_progress"
    ADD CONSTRAINT "student_progress_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."student_review_schedule"
    ADD CONSTRAINT "student_review_schedule_progress_id_fkey" FOREIGN KEY ("progress_id") REFERENCES "public"."student_progress"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_review_schedule"
    ADD CONSTRAINT "student_review_schedule_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."study_log"
    ADD CONSTRAINT "study_log_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_availability"
    ADD CONSTRAINT "teacher_availability_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_ijaza"
    ADD CONSTRAINT "teacher_ijaza_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_ijaza"
    ADD CONSTRAINT "teacher_ijaza_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."teacher_mentorship_feedback"
    ADD CONSTRAINT "teacher_mentorship_feedback_mentorship_id_fkey" FOREIGN KEY ("mentorship_id") REFERENCES "public"."teacher_mentorships"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_mentorship_feedback"
    ADD CONSTRAINT "teacher_mentorship_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."teacher_mentorship_feedback"
    ADD CONSTRAINT "teacher_mentorship_feedback_written_by_fkey" FOREIGN KEY ("written_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."teacher_mentorships"
    ADD CONSTRAINT "teacher_mentorships_mentee_id_fkey" FOREIGN KEY ("mentee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_mentorships"
    ADD CONSTRAINT "teacher_mentorships_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_profiles"
    ADD CONSTRAINT "teacher_profiles_cv_reviewed_by_fkey" FOREIGN KEY ("cv_reviewed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."teacher_profiles"
    ADD CONSTRAINT "teacher_profiles_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Admins full access_delete" ON "public"."blog_posts" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins full access_insert" ON "public"."blog_posts" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Admins full access_update" ON "public"."blog_posts" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "Public can read published posts" ON "public"."blog_posts" FOR SELECT USING ((("is_published" = true) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role"))))));



CREATE POLICY "admin mod manage offerings" ON "public"."class_offerings" USING ("public"."is_admin_or_mod"()) WITH CHECK ("public"."is_admin_or_mod"());



CREATE POLICY "admin_delete_review" ON "public"."reviews" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "admin_manage_announcements_delete" ON "public"."site_announcements" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "admin_manage_announcements_insert" ON "public"."site_announcements" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "admin_manage_announcements_update" ON "public"."site_announcements" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "admin_manage_contact_delete" ON "public"."contact_submissions" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "admin_manage_contact_select" ON "public"."contact_submissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "admin_manage_contact_update" ON "public"."contact_submissions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "admin_manage_packages_delete" ON "public"."packages" FOR DELETE USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_manage_packages_insert" ON "public"."packages" FOR INSERT WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "admin_manage_packages_update" ON "public"."packages" FOR UPDATE USING ("private"."is_admin_or_mod"()) WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "admin_manage_services_delete" ON "public"."services" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "admin_manage_services_insert" ON "public"."services" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "admin_manage_services_update" ON "public"."services" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "admin_mod_all_prefs_delete" ON "public"."communication_preferences" FOR DELETE USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_dead_letter" ON "public"."automation_dead_letter" USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_delete_eval" ON "public"."session_evaluations" FOR DELETE USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_notes_history_delete" ON "public"."session_notes_history" FOR DELETE USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_notes_history_insert" ON "public"."session_notes_history" FOR INSERT WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_notes_history_update" ON "public"."session_notes_history" FOR UPDATE USING ("private"."is_admin_or_mod"()) WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_observers" ON "public"."session_observers" USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_presence_delete" ON "public"."session_presence_events" FOR DELETE USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_presence_insert" ON "public"."session_presence_events" FOR INSERT WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_presence_update" ON "public"."session_presence_events" FOR UPDATE USING ("private"."is_admin_or_mod"()) WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_read_automation_logs" ON "public"."automation_logs" FOR SELECT USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_read_delivery_log" ON "public"."message_delivery_log" FOR SELECT USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_retention" ON "public"."retention_signals" USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_student_packages_delete" ON "public"."student_packages" FOR DELETE USING ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_student_packages_insert" ON "public"."student_packages" FOR INSERT WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "admin_mod_student_packages_update" ON "public"."student_packages" FOR UPDATE USING ("private"."is_admin_or_mod"()) WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "ae_all_delete" ON "public"."availability_exceptions" FOR DELETE USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "ae_all_insert" ON "public"."availability_exceptions" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "ae_all_update" ON "public"."availability_exceptions" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"())) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "ae_select" ON "public"."availability_exceptions" FOR SELECT USING ((true OR ((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"())));



CREATE POLICY "anyone_read_active_packages" ON "public"."packages" FOR SELECT USING ((("is_active" = true) OR "private"."is_admin_or_mod"()));



CREATE POLICY "anyone_read_services" ON "public"."services" FOR SELECT USING ((("is_active" = true) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role"))))));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_insert_admin" ON "public"."audit_log" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "audit_select" ON "public"."audit_log" FOR SELECT USING ("private"."is_admin"());



CREATE POLICY "authenticated_read_settings" ON "public"."platform_settings" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."automation_dead_letter" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."automation_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."availability_exceptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blog_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bookings_delete" ON "public"."bookings" FOR DELETE USING ((( SELECT "private"."is_admin"() AS "is_admin") OR ((( SELECT "auth"."uid"() AS "uid") = "student_id") AND ("status" = 'pending'::"public"."booking_status"))));



CREATE POLICY "bookings_insert" ON "public"."bookings" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR "private"."is_admin"()));



CREATE POLICY "bookings_select" ON "public"."bookings" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR (( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "bookings_update" ON "public"."bookings" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR (( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



ALTER TABLE "public"."class_offerings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."communication_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contact_submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_submissions_anon_insert" ON "public"."contact_submissions" FOR INSERT TO "anon" WITH CHECK ((((COALESCE("is_read", false) = false) AND (COALESCE("is_replied", false) = false) AND (("length"(COALESCE("full_name", ''::"text")) >= 1) AND ("length"(COALESCE("full_name", ''::"text")) <= 200)) AND (("length"(COALESCE("email", ''::"text")) >= 3) AND ("length"(COALESCE("email", ''::"text")) <= 320)) AND ("length"(COALESCE("message", ''::"text")) <= 5000)) OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role"))))));



CREATE POLICY "conv_admin_delete" ON "public"."conversations" FOR DELETE USING ("private"."is_admin_or_mod"());



CREATE POLICY "conv_admin_update" ON "public"."conversations" FOR UPDATE USING ("private"."is_admin_or_mod"()) WITH CHECK ("private"."is_admin_or_mod"());



CREATE POLICY "conv_insert" ON "public"."conversations" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR (( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin_or_mod"()));



CREATE POLICY "conv_select" ON "public"."conversations" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR (( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin_or_mod"()));



ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."course_enrollments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "course_enrollments_delete" ON "public"."course_enrollments" FOR DELETE USING (( SELECT "private"."is_admin"() AS "is_admin"));



CREATE POLICY "course_enrollments_insert" ON "public"."course_enrollments" FOR INSERT WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (("student_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("source" = 'free'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_enrollments"."course_id") AND ("c"."status" = 'published'::"text") AND ("c"."pricing_type" = 'free'::"text")))))));



CREATE POLICY "course_enrollments_select" ON "public"."course_enrollments" FOR SELECT USING ((( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("student_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_enrollments"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "course_enrollments_update" ON "public"."course_enrollments" FOR UPDATE USING ((( SELECT "private"."is_admin"() AS "is_admin") OR ("student_id" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR ("student_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."course_lesson_progress" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "course_lesson_progress_delete" ON "public"."course_lesson_progress" FOR DELETE USING (( SELECT "private"."is_admin"() AS "is_admin"));



CREATE POLICY "course_lesson_progress_insert" ON "public"."course_lesson_progress" FOR INSERT WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."course_enrollments" "e"
  WHERE (("e"."id" = "course_lesson_progress"."enrollment_id") AND ("e"."student_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "course_lesson_progress_select" ON "public"."course_lesson_progress" FOR SELECT USING ((( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."course_enrollments" "e"
  WHERE (("e"."id" = "course_lesson_progress"."enrollment_id") AND ("e"."student_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "course_lesson_progress_update" ON "public"."course_lesson_progress" FOR UPDATE USING ((( SELECT "private"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."course_enrollments" "e"
  WHERE (("e"."id" = "course_lesson_progress"."enrollment_id") AND ("e"."student_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."course_enrollments" "e"
  WHERE (("e"."id" = "course_lesson_progress"."enrollment_id") AND ("e"."student_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."course_lessons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "course_lessons_delete" ON "public"."course_lessons" FOR DELETE USING ((( SELECT "private"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_lessons"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("c"."status" = 'draft'::"text"))))));



CREATE POLICY "course_lessons_insert" ON "public"."course_lessons" FOR INSERT WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_lessons"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("c"."status" = ANY (ARRAY['draft'::"text", 'rejected'::"text"])))))));



CREATE POLICY "course_lessons_select" ON "public"."course_lessons" FOR SELECT USING ((( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_lessons"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ((EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_lessons"."course_id") AND ("c"."status" = 'published'::"text")))) AND (("is_preview" = true) OR (EXISTS ( SELECT 1
   FROM "public"."course_enrollments" "e"
  WHERE (("e"."course_id" = "course_lessons"."course_id") AND ("e"."student_id" = ( SELECT "auth"."uid"() AS "uid")))))))));



CREATE POLICY "course_lessons_update" ON "public"."course_lessons" FOR UPDATE USING ((( SELECT "private"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_lessons"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("c"."status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'rejected'::"text"]))))))) WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "course_lessons"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("c"."status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'rejected'::"text"])))))));



ALTER TABLE "public"."course_payouts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "course_payouts_delete" ON "public"."course_payouts" FOR DELETE USING (( SELECT "private"."is_admin"() AS "is_admin"));



CREATE POLICY "course_payouts_insert" ON "public"."course_payouts" FOR INSERT WITH CHECK (( SELECT "private"."is_admin"() AS "is_admin"));



CREATE POLICY "course_payouts_select" ON "public"."course_payouts" FOR SELECT USING ((( SELECT "private"."is_admin"() AS "is_admin") OR ("teacher_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "course_payouts_update" ON "public"."course_payouts" FOR UPDATE USING (( SELECT "private"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "private"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."course_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "course_reviews_delete" ON "public"."course_reviews" FOR DELETE USING (( SELECT "private"."is_admin"() AS "is_admin"));



CREATE POLICY "course_reviews_insert" ON "public"."course_reviews" FOR INSERT WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (("student_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."course_enrollments" "e"
  WHERE (("e"."id" = "course_reviews"."enrollment_id") AND ("e"."student_id" = ( SELECT "auth"."uid"() AS "uid"))))))));



CREATE POLICY "course_reviews_select" ON "public"."course_reviews" FOR SELECT USING ((( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("status" = 'published'::"text") OR ("student_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "course_reviews_update" ON "public"."course_reviews" FOR UPDATE USING ((( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("student_id" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("student_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "courses_delete" ON "public"."courses" FOR DELETE USING ((( SELECT "private"."is_admin"() AS "is_admin") OR (("teacher_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = 'draft'::"text"))));



CREATE POLICY "courses_insert" ON "public"."courses" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod"));



CREATE POLICY "courses_select" ON "public"."courses" FOR SELECT USING ((( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("teacher_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("status" = 'published'::"text")));



CREATE POLICY "courses_update" ON "public"."courses" FOR UPDATE USING ((( SELECT "private"."is_admin"() AS "is_admin") OR (("teacher_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'rejected'::"text"]))))) WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (("teacher_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'rejected'::"text"])))));



CREATE POLICY "credits_admin_delete" ON "public"."student_credits" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "credits_admin_insert" ON "public"."student_credits" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "credits_admin_update" ON "public"."student_credits" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "credits_select" ON "public"."student_credits" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR "private"."is_admin"()));



ALTER TABLE "public"."daily_webhook_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "errors_insert" ON "public"."recitation_errors" FOR INSERT WITH CHECK (("progress_id" IN ( SELECT "student_progress"."id"
   FROM "public"."student_progress"
  WHERE ("student_progress"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "errors_select" ON "public"."recitation_errors" FOR SELECT USING (("progress_id" IN ( SELECT "student_progress"."id"
   FROM "public"."student_progress"
  WHERE (("student_progress"."student_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("student_progress"."teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "errors_update" ON "public"."recitation_errors" FOR UPDATE USING (("progress_id" IN ( SELECT "student_progress"."id"
   FROM "public"."student_progress"
  WHERE ("student_progress"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "eval_insert" ON "public"."session_evaluations" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin_or_mod"()));



CREATE POLICY "eval_select" ON "public"."session_evaluations" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR (( SELECT "auth"."uid"() AS "uid") = "student_id") OR "private"."is_admin_or_mod"()));



CREATE POLICY "eval_update" ON "public"."session_evaluations" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin_or_mod"()));



ALTER TABLE "public"."forum_likes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "forum_likes_owner" ON "public"."forum_likes" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."forum_replies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "forum_replies_delete" ON "public"."forum_replies" FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "author_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "forum_replies_insert" ON "public"."forum_replies" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "author_id"));



CREATE POLICY "forum_replies_select" ON "public"."forum_replies" FOR SELECT USING ((("is_hidden" = false) OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "forum_replies_update" ON "public"."forum_replies" FOR UPDATE TO "authenticated" USING ((((( SELECT "auth"."uid"() AS "uid") = "author_id") AND ("is_hidden" = false)) OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "author_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



ALTER TABLE "public"."forum_reports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "forum_reports_delete" ON "public"."forum_reports" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod"));



CREATE POLICY "forum_reports_insert" ON "public"."forum_reports" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "reporter_id"));



CREATE POLICY "forum_reports_select" ON "public"."forum_reports" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "reporter_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "forum_reports_update" ON "public"."forum_reports" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")) WITH CHECK (( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod"));



ALTER TABLE "public"."forum_threads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "forum_threads_delete" ON "public"."forum_threads" FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "author_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "forum_threads_insert" ON "public"."forum_threads" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "author_id"));



CREATE POLICY "forum_threads_select" ON "public"."forum_threads" FOR SELECT USING ((("is_hidden" = false) OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "forum_threads_update" ON "public"."forum_threads" FOR UPDATE TO "authenticated" USING ((((( SELECT "auth"."uid"() AS "uid") = "author_id") AND ("is_hidden" = false)) OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "author_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



ALTER TABLE "public"."halaqa_waiting_list" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "halaqa_waiting_list_delete" ON "public"."halaqa_waiting_list" FOR DELETE TO "authenticated" USING ((("student_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."bookings" "b" ON (("b"."id" = "s"."booking_id")))
  WHERE (("s"."id" = "b"."session_id") AND ("b"."teacher_id" = "auth"."uid"())))) OR "public"."is_admin_or_mod"()));



CREATE POLICY "halaqa_waiting_list_insert" ON "public"."halaqa_waiting_list" FOR INSERT TO "authenticated" WITH CHECK ((("student_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."bookings" "b" ON (("b"."id" = "s"."booking_id")))
  WHERE (("s"."id" = "b"."session_id") AND (("b"."student_id" = "auth"."uid"()) OR ("b"."teacher_id" = "auth"."uid"())))))));



CREATE POLICY "halaqa_waiting_list_select" ON "public"."halaqa_waiting_list" FOR SELECT TO "authenticated" USING ((("student_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."bookings" "b" ON (("b"."id" = "s"."booking_id")))
  WHERE (("s"."id" = "b"."session_id") AND ("b"."teacher_id" = "auth"."uid"())))) OR "public"."is_admin_or_mod"()));



CREATE POLICY "halaqa_waiting_list_update" ON "public"."halaqa_waiting_list" FOR UPDATE TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."bookings" "b" ON (("b"."id" = "s"."booking_id")))
  WHERE (("s"."id" = "b"."session_id") AND ("b"."teacher_id" = "auth"."uid"())))) OR "public"."is_admin_or_mod"())) WITH CHECK (((EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."bookings" "b" ON (("b"."id" = "s"."booking_id")))
  WHERE (("s"."id" = "b"."session_id") AND ("b"."teacher_id" = "auth"."uid"())))) OR "public"."is_admin_or_mod"()));



ALTER TABLE "public"."help_articles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "help_articles_delete" ON "public"."help_articles" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "help_articles_insert" ON "public"."help_articles" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "help_articles_select" ON "public"."help_articles" FOR SELECT USING ((("is_published" = true) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "help_articles_update" ON "public"."help_articles" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."help_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "help_categories_delete" ON "public"."help_categories" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "help_categories_insert" ON "public"."help_categories" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "help_categories_select" ON "public"."help_categories" FOR SELECT USING (true);



CREATE POLICY "help_categories_update" ON "public"."help_categories" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "homework_all_delete" ON "public"."homework_assignments" FOR DELETE USING ((( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("teacher_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "homework_all_insert" ON "public"."homework_assignments" FOR INSERT WITH CHECK ((( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("teacher_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."homework_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ijaza_all_delete" ON "public"."teacher_ijaza" FOR DELETE USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "ijaza_all_insert" ON "public"."teacher_ijaza" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "ijaza_all_update" ON "public"."teacher_ijaza" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"())) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "ijaza_select" ON "public"."teacher_ijaza" FOR SELECT USING ((true OR ((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"())));



ALTER TABLE "public"."ijazah_pathways" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ijazah_pathways_admin_write" ON "public"."ijazah_pathways" USING ("public"."is_admin_or_mod"());



CREATE POLICY "ijazah_pathways_public_read" ON "public"."ijazah_pathways" FOR SELECT USING ((("is_active" = true) OR "public"."is_admin_or_mod"()));



ALTER TABLE "public"."ijazah_requirements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ijazah_requirements_admin_write" ON "public"."ijazah_requirements" USING ("public"."is_admin_or_mod"());



CREATE POLICY "ijazah_requirements_public_read" ON "public"."ijazah_requirements" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."ijazah_pathways" "p"
  WHERE (("p"."id" = "ijazah_requirements"."pathway_id") AND (("p"."is_active" = true) OR "public"."is_admin_or_mod"())))));



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_select" ON "public"."invoices" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR "private"."is_admin"()));



CREATE POLICY "languages_admin_write_delete" ON "public"."teacher_languages" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "languages_admin_write_insert" ON "public"."teacher_languages" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "languages_admin_write_update" ON "public"."teacher_languages" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "languages_read" ON "public"."teacher_languages" FOR SELECT USING ((true OR "private"."is_admin"()));



CREATE POLICY "legal_admin_write_delete" ON "public"."legal_documents" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "legal_admin_write_insert" ON "public"."legal_documents" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "legal_admin_write_update" ON "public"."legal_documents" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "legal_anon_read" ON "public"."legal_documents" FOR SELECT USING ((true OR "private"."is_admin"()));



ALTER TABLE "public"."legal_document_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legal_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "legal_versions_admin_read" ON "public"."legal_document_versions" FOR SELECT USING (("private"."is_admin"() OR "private"."is_admin"()));



CREATE POLICY "legal_versions_admin_write_delete" ON "public"."legal_document_versions" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "legal_versions_admin_write_insert" ON "public"."legal_document_versions" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "legal_versions_admin_write_update" ON "public"."legal_document_versions" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



ALTER TABLE "public"."message_delivery_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "migrations_select" ON "public"."schema_migrations" FOR SELECT USING ("private"."is_admin"());



ALTER TABLE "public"."module_lessons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "module_lessons_delete" ON "public"."module_lessons" FOR DELETE TO "authenticated" USING ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM ("public"."modules" "m"
     JOIN "public"."courses" "c" ON (("c"."id" = "m"."course_id")))
  WHERE (("m"."id" = "module_lessons"."module_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "module_lessons_insert" ON "public"."module_lessons" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM ("public"."modules" "m"
     JOIN "public"."courses" "c" ON (("c"."id" = "m"."course_id")))
  WHERE (("m"."id" = "module_lessons"."module_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "module_lessons_select" ON "public"."module_lessons" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM ("public"."modules" "m"
     JOIN "public"."courses" "c" ON (("c"."id" = "m"."course_id")))
  WHERE (("m"."id" = "module_lessons"."module_id") AND (("c"."status" = 'published'::"text") OR ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "module_lessons_update" ON "public"."module_lessons" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM ("public"."modules" "m"
     JOIN "public"."courses" "c" ON (("c"."id" = "m"."course_id")))
  WHERE (("m"."id" = "module_lessons"."module_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM ("public"."modules" "m"
     JOIN "public"."courses" "c" ON (("c"."id" = "m"."course_id")))
  WHERE (("m"."id" = "module_lessons"."module_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."modules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "modules_delete" ON "public"."modules" FOR DELETE TO "authenticated" USING ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "modules"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "modules_insert" ON "public"."modules" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "modules"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "modules_select" ON "public"."modules" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "modules"."course_id") AND (("c"."status" = 'published'::"text") OR ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "modules_update" ON "public"."modules" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "modules"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "modules"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "msg_admin_delete" ON "public"."messages" FOR DELETE USING ("private"."is_admin_or_mod"());



CREATE POLICY "msg_insert" ON "public"."messages" FOR INSERT WITH CHECK ((((( SELECT "auth"."uid"() AS "uid") = "sender_id") AND ("conversation_id" IN ( SELECT "conversations"."id"
   FROM "public"."conversations"
  WHERE (("conversations"."student_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("conversations"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR "private"."is_admin_or_mod"()));



CREATE POLICY "msg_select" ON "public"."messages" FOR SELECT USING (((("deleted_at" IS NULL) AND ("conversation_id" IN ( SELECT "conversations"."id"
   FROM "public"."conversations"
  WHERE (("conversations"."student_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("conversations"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR "private"."is_admin_or_mod"()));



CREATE POLICY "msg_update" ON "public"."messages" FOR UPDATE USING ((((( SELECT "auth"."uid"() AS "uid") = "sender_id") AND ("deleted_at" IS NULL)) OR "private"."is_admin_or_mod"()));



CREATE POLICY "notif_all" ON "public"."notifications" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."notification_broadcasts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_broadcasts_admin" ON "public"."notification_broadcasts" TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."packages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parent_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_select" ON "public"."payments" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR "private"."is_admin"()));



ALTER TABLE "public"."platform_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert" ON "public"."profiles" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT USING ("private"."profile_is_visible"("id"));



CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE USING ((( SELECT "private"."is_admin"() AS "is_admin") OR (( SELECT "auth"."uid"() AS "uid") = "id"))) WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (( SELECT "auth"."uid"() AS "uid") = "id")));



CREATE POLICY "progress_admin_delete" ON "public"."student_progress" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "progress_admin_update" ON "public"."student_progress" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "progress_insert" ON "public"."student_progress" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role"))))));



CREATE POLICY "progress_select" ON "public"."student_progress" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR (( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role"))))));



CREATE POLICY "pt_select" ON "public"."payment_transactions" FOR SELECT USING ("private"."is_admin"());



CREATE POLICY "public_read_active_announcements" ON "public"."site_announcements" FOR SELECT USING (((("active_from" <= "now"()) AND (("active_until" IS NULL) OR ("active_until" > "now"()))) OR "private"."is_admin"()));



ALTER TABLE "public"."quiz_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quiz_attempts_delete" ON "public"."quiz_attempts" FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "quiz_attempts_insert" ON "public"."quiz_attempts" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "quiz_attempts_select" ON "public"."quiz_attempts" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM ("public"."quizzes" "q"
     JOIN "public"."courses" "c" ON (("c"."id" = "q"."course_id")))
  WHERE (("q"."id" = "quiz_attempts"."quiz_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "quiz_attempts_update" ON "public"."quiz_attempts" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



ALTER TABLE "public"."quiz_question_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quiz_question_keys_owner_select" ON "public"."quiz_question_keys" FOR SELECT TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM (("public"."quiz_questions" "qq"
     JOIN "public"."quizzes" "q" ON (("q"."id" = "qq"."quiz_id")))
     JOIN "public"."courses" "c" ON (("c"."id" = "q"."course_id")))
  WHERE (("qq"."id" = "quiz_question_keys"."question_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "quiz_question_keys_owner_write" ON "public"."quiz_question_keys" TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM (("public"."quiz_questions" "qq"
     JOIN "public"."quizzes" "q" ON (("q"."id" = "qq"."quiz_id")))
     JOIN "public"."courses" "c" ON (("c"."id" = "q"."course_id")))
  WHERE (("qq"."id" = "quiz_question_keys"."question_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR (EXISTS ( SELECT 1
   FROM (("public"."quiz_questions" "qq"
     JOIN "public"."quizzes" "q" ON (("q"."id" = "qq"."quiz_id")))
     JOIN "public"."courses" "c" ON (("c"."id" = "q"."course_id")))
  WHERE (("qq"."id" = "quiz_question_keys"."question_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."quiz_questions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quiz_questions_delete" ON "public"."quiz_questions" FOR DELETE TO "authenticated" USING ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM ("public"."quizzes" "q"
     JOIN "public"."courses" "c" ON (("c"."id" = "q"."course_id")))
  WHERE (("q"."id" = "quiz_questions"."quiz_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "quiz_questions_insert" ON "public"."quiz_questions" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM ("public"."quizzes" "q"
     JOIN "public"."courses" "c" ON (("c"."id" = "q"."course_id")))
  WHERE (("q"."id" = "quiz_questions"."quiz_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "quiz_questions_select" ON "public"."quiz_questions" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM ("public"."quizzes" "q"
     JOIN "public"."courses" "c" ON (("c"."id" = "q"."course_id")))
  WHERE (("q"."id" = "quiz_questions"."quiz_id") AND ((("q"."is_published" = true) AND ("c"."status" = 'published'::"text")) OR ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "quiz_questions_update" ON "public"."quiz_questions" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM ("public"."quizzes" "q"
     JOIN "public"."courses" "c" ON (("c"."id" = "q"."course_id")))
  WHERE (("q"."id" = "quiz_questions"."quiz_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM ("public"."quizzes" "q"
     JOIN "public"."courses" "c" ON (("c"."id" = "q"."course_id")))
  WHERE (("q"."id" = "quiz_questions"."quiz_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."quizzes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quizzes_delete" ON "public"."quizzes" FOR DELETE TO "authenticated" USING ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "quizzes"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "quizzes_insert" ON "public"."quizzes" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "quizzes"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "quizzes_select" ON "public"."quizzes" FOR SELECT USING (((("is_published" = true) AND (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "quizzes"."course_id") AND ("c"."status" = 'published'::"text"))))) OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "quizzes"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "quizzes_update" ON "public"."quizzes" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "quizzes"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))))) WITH CHECK ((( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod") OR (EXISTS ( SELECT 1
   FROM "public"."courses" "c"
  WHERE (("c"."id" = "quizzes"."course_id") AND ("c"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."quran_surahs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quran_surahs_read_all" ON "public"."quran_surahs" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."recitation_errors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recitations_admin_write_delete" ON "public"."teacher_recitations" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "recitations_admin_write_insert" ON "public"."teacher_recitations" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "recitations_admin_write_update" ON "public"."teacher_recitations" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "recitations_read" ON "public"."teacher_recitations" FOR SELECT USING ((true OR "private"."is_admin"()));



ALTER TABLE "public"."refund_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."remote_handoff_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "remote_handoff_tokens_delete" ON "public"."remote_handoff_tokens" FOR DELETE TO "authenticated" USING ((("admin_user_id" = "auth"."uid"()) OR "public"."is_admin_or_mod"()));



CREATE POLICY "remote_handoff_tokens_insert" ON "public"."remote_handoff_tokens" FOR INSERT TO "authenticated" WITH CHECK ((("admin_user_id" = "auth"."uid"()) OR "public"."is_admin_or_mod"()));



CREATE POLICY "remote_handoff_tokens_select" ON "public"."remote_handoff_tokens" FOR SELECT TO "authenticated" USING ((("admin_user_id" = "auth"."uid"()) OR "public"."is_admin_or_mod"()));



CREATE POLICY "remote_handoff_tokens_update" ON "public"."remote_handoff_tokens" FOR UPDATE TO "authenticated" USING ((("admin_user_id" = "auth"."uid"()) OR "public"."is_admin_or_mod"())) WITH CHECK ((("admin_user_id" = "auth"."uid"()) OR "public"."is_admin_or_mod"()));



CREATE POLICY "report_insert" ON "public"."parent_reports" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin_or_mod"()));



CREATE POLICY "report_select" ON "public"."parent_reports" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR (( SELECT "auth"."uid"() AS "uid") = "student_id") OR "private"."is_admin_or_mod"()));



ALTER TABLE "public"."resource_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "resource_assignments_admin_all" ON "public"."resource_assignments" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'admin'::"public"."user_role"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'admin'::"public"."user_role")))));



CREATE POLICY "resource_assignments_student_read" ON "public"."resource_assignments" FOR SELECT TO "authenticated" USING (("student_id" = "auth"."uid"()));



CREATE POLICY "resource_assignments_teacher_all" ON "public"."resource_assignments" TO "authenticated" USING (("assigned_by" = "auth"."uid"())) WITH CHECK (("assigned_by" = "auth"."uid"()));



ALTER TABLE "public"."resources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "resources_delete" ON "public"."resources" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "resources_insert" ON "public"."resources" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "resources_select" ON "public"."resources" FOR SELECT USING ((("is_published" = true) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "resources_student_via_assignment" ON "public"."resources" FOR SELECT TO "authenticated" USING ((("created_by_teacher_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."resource_assignments" "ra"
  WHERE (("ra"."resource_id" = "ra"."id") AND ("ra"."student_id" = "auth"."uid"()))))));



CREATE POLICY "resources_teacher_own" ON "public"."resources" TO "authenticated" USING (("created_by_teacher_id" = "auth"."uid"())) WITH CHECK (("created_by_teacher_id" = "auth"."uid"()));



CREATE POLICY "resources_update" ON "public"."resources" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."retention_signals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reviews_insert" ON "public"."reviews" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "student_id") AND (( SELECT "bookings"."status"
   FROM "public"."bookings"
  WHERE ("bookings"."id" = "reviews"."booking_id")) = 'completed'::"public"."booking_status")));



CREATE POLICY "reviews_select" ON "public"."reviews" FOR SELECT USING (("is_public" = true));



CREATE POLICY "reviews_update" ON "public"."reviews" FOR UPDATE USING ((( SELECT "private"."is_admin"() AS "is_admin") OR (( SELECT "auth"."uid"() AS "uid") = "student_id") OR (( SELECT "auth"."uid"() AS "uid") = "teacher_id"))) WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (( SELECT "auth"."uid"() AS "uid") = "student_id") OR (( SELECT "auth"."uid"() AS "uid") = "teacher_id")));



CREATE POLICY "rp_admin_delete" ON "public"."refund_policies" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "rp_admin_insert" ON "public"."refund_policies" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "rp_admin_update" ON "public"."refund_policies" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "rp_select" ON "public"."refund_policies" FOR SELECT USING ((true OR "private"."is_admin"()));



ALTER TABLE "public"."schema_migrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_evaluations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_notes_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_observers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."session_presence_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "session_presence_events_select" ON "public"."session_presence_events" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."bookings" "b" ON (("b"."id" = "s"."booking_id")))
  WHERE (("s"."id" = "session_presence_events"."session_id") AND (("b"."student_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("b"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")))))) OR "private"."is_admin_or_mod"()));



ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sessions_admin_delete" ON "public"."sessions" FOR DELETE USING ("private"."is_admin_or_mod"());



CREATE POLICY "sessions_insert" ON "public"."sessions" FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."bookings"
  WHERE (("bookings"."id" = "sessions"."booking_id") AND (("bookings"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."profiles"
          WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))))))) OR "private"."is_admin_or_mod"()));



CREATE POLICY "sessions_select" ON "public"."sessions" FOR SELECT USING ((("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE (("bookings"."student_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("bookings"."teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR "private"."is_admin_or_mod"()));



CREATE POLICY "sessions_select_via_participants_v2" ON "public"."sessions" FOR SELECT TO "authenticated" USING ("public"."user_is_session_participant"("id"));



COMMENT ON POLICY "sessions_select_via_participants_v2" ON "public"."sessions" IS 'Halaqa enrollment access (recursion-safe v2). Calls user_is_session_participant() which is SECURITY DEFINER, so the inner check on session_participants does not re-trigger sessions RLS. Replaces v1 (sessions_select_via_participants) which was dropped on 2026-05-06 due to mutual recursion with session_participants own policy.';



CREATE POLICY "sessions_update" ON "public"."sessions" FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM "public"."bookings"
  WHERE (("bookings"."id" = "sessions"."booking_id") AND (("bookings"."teacher_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("bookings"."student_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."profiles"
          WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."role" = 'admin'::"public"."user_role")))))))) OR "private"."is_admin_or_mod"()));



CREATE POLICY "settings_insert" ON "public"."platform_settings" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "settings_update" ON "public"."platform_settings" FOR UPDATE USING ("private"."is_admin"());



ALTER TABLE "public"."site_announcements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "site_blog_cat_admin_write_delete" ON "public"."site_blog_categories" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "site_blog_cat_admin_write_insert" ON "public"."site_blog_categories" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "site_blog_cat_admin_write_update" ON "public"."site_blog_categories" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "site_blog_cat_anon_read" ON "public"."site_blog_categories" FOR SELECT USING (("is_active" OR "private"."is_admin"()));



ALTER TABLE "public"."site_blog_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_faqs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "site_faqs_admin_write_delete" ON "public"."site_faqs" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "site_faqs_admin_write_insert" ON "public"."site_faqs" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "site_faqs_admin_write_update" ON "public"."site_faqs" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "site_faqs_anon_read" ON "public"."site_faqs" FOR SELECT USING (("is_active" OR "private"."is_admin"()));



ALTER TABLE "public"."site_features" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "site_features_admin_write_delete" ON "public"."site_features" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "site_features_admin_write_insert" ON "public"."site_features" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "site_features_admin_write_update" ON "public"."site_features" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "site_features_anon_read" ON "public"."site_features" FOR SELECT USING (("is_active" OR "private"."is_admin"()));



CREATE POLICY "sp_delete_admin_only" ON "public"."session_participants" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "sp_select_self_or_teacher_or_admin" ON "public"."session_participants" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."bookings" "b" ON (("s"."booking_id" = "b"."id")))
  WHERE (("s"."id" = "session_participants"."session_id") AND ("b"."teacher_id" = "auth"."uid"())))) OR "public"."is_admin_or_mod"()));



COMMENT ON POLICY "sp_select_self_or_teacher_or_admin" ON "public"."session_participants" IS 'Halaqa enrollment readability: own row OR teacher of session (via bookings.teacher_id) OR admin/moderator. The companion sessions read path for halaqa enrollees was dropped in the 2026-05-06 hotfix due to mutual recursion; Stage 5 will reintroduce it via a SECURITY DEFINER helper to break the cycle.';



CREATE POLICY "sp_update_own_attendance_or_teacher_or_admin" ON "public"."session_participants" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."bookings" "b" ON (("s"."booking_id" = "b"."id")))
  WHERE (("s"."id" = "session_participants"."session_id") AND ("b"."teacher_id" = "auth"."uid"())))) OR "public"."is_admin_or_mod"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."sessions" "s"
     JOIN "public"."bookings" "b" ON (("s"."booking_id" = "b"."id")))
  WHERE (("s"."id" = "session_participants"."session_id") AND ("b"."teacher_id" = "auth"."uid"())))) OR "public"."is_admin_or_mod"()));



CREATE POLICY "specialties_admin_write_delete" ON "public"."teacher_specialties" FOR DELETE USING ("private"."is_admin"());



CREATE POLICY "specialties_admin_write_insert" ON "public"."teacher_specialties" FOR INSERT WITH CHECK ("private"."is_admin"());



CREATE POLICY "specialties_admin_write_update" ON "public"."teacher_specialties" FOR UPDATE USING ("private"."is_admin"()) WITH CHECK ("private"."is_admin"());



CREATE POLICY "specialties_read" ON "public"."teacher_specialties" FOR SELECT USING ((true OR "private"."is_admin"()));



CREATE POLICY "srs__admin_all" ON "public"."student_review_schedule" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "srs__student_read" ON "public"."student_review_schedule" FOR SELECT USING (("student_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "srs__student_update" ON "public"."student_review_schedule" FOR UPDATE USING (("student_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("student_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "student read open offerings" ON "public"."class_offerings" FOR SELECT USING (("status" = ANY (ARRAY['open'::"text", 'full'::"text", 'confirmed'::"text"])));



ALTER TABLE "public"."student_credits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_ijazah_progress" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_ijazah_progress_admin_full" ON "public"."student_ijazah_progress" USING ("public"."is_admin_or_mod"());



CREATE POLICY "student_ijazah_progress_student_read" ON "public"."student_ijazah_progress" FOR SELECT USING (("student_id" = "auth"."uid"()));



CREATE POLICY "student_ijazah_progress_teacher_read" ON "public"."student_ijazah_progress" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."teacher_id" = "auth"."uid"()) AND ("b"."student_id" = "student_ijazah_progress"."student_id") AND ("b"."deleted_at" IS NULL)))));



CREATE POLICY "student_ijazah_req_progress_admin_full" ON "public"."student_ijazah_requirement_progress" USING ("public"."is_admin_or_mod"());



CREATE POLICY "student_ijazah_req_progress_student_read" ON "public"."student_ijazah_requirement_progress" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."student_ijazah_progress" "sp"
  WHERE (("sp"."id" = "student_ijazah_requirement_progress"."student_progress_id") AND ("sp"."student_id" = "auth"."uid"())))));



CREATE POLICY "student_ijazah_req_progress_teacher_read" ON "public"."student_ijazah_requirement_progress" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."student_ijazah_progress" "sp"
     JOIN "public"."bookings" "b" ON (("b"."student_id" = "sp"."student_id")))
  WHERE (("sp"."id" = "student_ijazah_requirement_progress"."student_progress_id") AND ("b"."teacher_id" = "auth"."uid"()) AND ("b"."deleted_at" IS NULL)))));



CREATE POLICY "student_ijazah_req_progress_teacher_write" ON "public"."student_ijazah_requirement_progress" FOR INSERT WITH CHECK ((("verifying_teacher_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."student_ijazah_progress" "sp"
     JOIN "public"."bookings" "b" ON (("b"."student_id" = "sp"."student_id")))
  WHERE (("sp"."id" = "student_ijazah_requirement_progress"."student_progress_id") AND ("b"."teacher_id" = "auth"."uid"()) AND ("b"."deleted_at" IS NULL))))));



ALTER TABLE "public"."student_ijazah_requirement_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_packages_teacher_read" ON "public"."student_packages" FOR SELECT TO "authenticated" USING ("private"."teacher_has_booked_student"("auth"."uid"(), "student_id"));



ALTER TABLE "public"."student_progress" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_read_homework" ON "public"."homework_assignments" FOR SELECT USING ((("student_id" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("teacher_id" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "student_read_own_packages" ON "public"."student_packages" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR "private"."is_admin_or_mod"()));



CREATE POLICY "student_read_reports" ON "public"."parent_reports" FOR SELECT USING (("student_id" = "auth"."uid"()));



ALTER TABLE "public"."student_review_schedule" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "student_update_homework" ON "public"."homework_assignments" FOR UPDATE USING ((("student_id" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("teacher_id" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((("student_id" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "private"."is_admin_or_mod"() AS "is_admin_or_mod") OR ("teacher_id" = ( SELECT "auth"."uid"() AS "uid")))));



ALTER TABLE "public"."study_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "study_log_access" ON "public"."study_log" TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "student_id") OR ( SELECT "public"."is_admin_or_mod"() AS "is_admin_or_mod")));



CREATE POLICY "ta_all_delete" ON "public"."teacher_availability" FOR DELETE USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "ta_all_insert" ON "public"."teacher_availability" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "ta_all_update" ON "public"."teacher_availability" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"())) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "ta_select" ON "public"."teacher_availability" FOR SELECT USING ((true OR ((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"())));



CREATE POLICY "teacher rw own offerings" ON "public"."class_offerings" USING (("teacher_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("teacher_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."teacher_availability" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teacher_ijaza" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teacher_languages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teacher_mentorship_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_mentorship_feedback_admin_full" ON "public"."teacher_mentorship_feedback" USING ("public"."is_admin_or_mod"());



CREATE POLICY "teacher_mentorship_feedback_mentor_write" ON "public"."teacher_mentorship_feedback" FOR INSERT WITH CHECK ((("written_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."teacher_mentorships" "m"
  WHERE (("m"."id" = "teacher_mentorship_feedback"."mentorship_id") AND ("m"."mentor_id" = "auth"."uid"()) AND ("m"."status" = 'active'::"text"))))));



CREATE POLICY "teacher_mentorship_feedback_party_read" ON "public"."teacher_mentorship_feedback" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teacher_mentorships" "m"
  WHERE (("m"."id" = "teacher_mentorship_feedback"."mentorship_id") AND (("m"."mentor_id" = "auth"."uid"()) OR ("m"."mentee_id" = "auth"."uid"()))))));



ALTER TABLE "public"."teacher_mentorships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_mentorships_admin_full" ON "public"."teacher_mentorships" USING ("public"."is_admin_or_mod"());



CREATE POLICY "teacher_mentorships_party_read" ON "public"."teacher_mentorships" FOR SELECT USING ((("mentor_id" = "auth"."uid"()) OR ("mentee_id" = "auth"."uid"())));



CREATE POLICY "teacher_notes_history" ON "public"."session_notes_history" FOR SELECT USING ((("saved_by" = ( SELECT "auth"."uid"() AS "uid")) OR "private"."is_admin_or_mod"()));



ALTER TABLE "public"."teacher_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teacher_recitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teacher_specialties" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tp_insert" ON "public"."teacher_profiles" FOR INSERT WITH CHECK ((( SELECT "private"."is_admin"() AS "is_admin") OR (( SELECT "auth"."uid"() AS "uid") = "teacher_id")));



CREATE POLICY "tp_select_anon_approved" ON "public"."teacher_profiles" FOR SELECT TO "anon" USING ((("cv_status" = 'approved'::"public"."cv_status") AND ("is_archived" = false) AND ("is_accepting" = true)));



CREATE POLICY "tp_select_authenticated" ON "public"."teacher_profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "tp_update" ON "public"."teacher_profiles" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "teacher_id") OR "private"."is_admin"()));



CREATE POLICY "user_insert_own_prefs" ON "public"."communication_preferences" FOR INSERT WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR "private"."is_admin_or_mod"()));



CREATE POLICY "user_read_own_prefs" ON "public"."communication_preferences" FOR SELECT USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR "private"."is_admin_or_mod"()));



CREATE POLICY "user_update_own_prefs" ON "public"."communication_preferences" FOR UPDATE USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR "private"."is_admin_or_mod"()));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."bookings";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."notifications";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."sessions";



GRANT USAGE ON SCHEMA "private" TO "anon";
GRANT USAGE ON SCHEMA "private" TO "authenticated";
GRANT USAGE ON SCHEMA "private" TO "service_role";
GRANT USAGE ON SCHEMA "private" TO "supabase_auth_admin";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































































































































































































































































































































































































































































































































































































































REVOKE ALL ON FUNCTION "private"."ensure_teacher_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."ensure_teacher_profile"() TO "service_role";
GRANT ALL ON FUNCTION "private"."ensure_teacher_profile"() TO "anon";
GRANT ALL ON FUNCTION "private"."ensure_teacher_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "private"."ensure_teacher_profile"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "private"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."handle_new_user"() TO "service_role";
GRANT ALL ON FUNCTION "private"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "private"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "private"."handle_new_user"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "private"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_admin"() TO "service_role";
GRANT ALL ON FUNCTION "private"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "private"."is_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_admin_or_mod"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_admin_or_mod"() TO "service_role";
GRANT ALL ON FUNCTION "private"."is_admin_or_mod"() TO "anon";
GRANT ALL ON FUNCTION "private"."is_admin_or_mod"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_moderator"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_moderator"() TO "service_role";
GRANT ALL ON FUNCTION "private"."is_moderator"() TO "anon";
GRANT ALL ON FUNCTION "private"."is_moderator"() TO "authenticated";



REVOKE ALL ON FUNCTION "private"."profile_is_visible"("p_target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."profile_is_visible"("p_target" "uuid") TO "anon";
GRANT ALL ON FUNCTION "private"."profile_is_visible"("p_target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "private"."profile_is_visible"("p_target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "private"."rls_auto_enable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."rls_auto_enable"() TO "service_role";
GRANT ALL ON FUNCTION "private"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "private"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "private"."rls_auto_enable"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "private"."sync_teacher_archive_with_profile"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."sync_teacher_archive_with_profile"() TO "service_role";
GRANT ALL ON FUNCTION "private"."sync_teacher_archive_with_profile"() TO "anon";
GRANT ALL ON FUNCTION "private"."sync_teacher_archive_with_profile"() TO "authenticated";
GRANT ALL ON FUNCTION "private"."sync_teacher_archive_with_profile"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "private"."teacher_has_booked_student"("p_teacher" "uuid", "p_student" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."teacher_has_booked_student"("p_teacher" "uuid", "p_student" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."audit_log_redact_pii_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_log_redact_pii_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_log_redact_pii_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calc_actual_duration"() TO "anon";
GRANT ALL ON FUNCTION "public"."calc_actual_duration"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calc_actual_duration"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_homework_chain_depth"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_homework_chain_depth"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_review"("p_schedule_id" "uuid", "p_easiness" real, "p_interval_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_review"("p_schedule_id" "uuid", "p_easiness" real, "p_interval_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_review"("p_schedule_id" "uuid", "p_easiness" real, "p_interval_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_murajaah_batch_for_date"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_murajaah_batch_for_date"("p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_booking_with_session"("p_booking_id" "uuid", "p_room_url" "text", "p_room_name" "text", "p_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_booking_with_session"("p_booking_id" "uuid", "p_room_url" "text", "p_room_name" "text", "p_expires_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_booking_with_session"("p_booking_id" "uuid", "p_room_url" "text", "p_room_name" "text", "p_expires_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."deduct_package_session"("p_package_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deduct_package_session"("p_package_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."deduct_package_session_mode"("p_package_id" "uuid", "p_mode" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deduct_package_session_mode"("p_package_id" "uuid", "p_mode" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."deduct_student_credit"() TO "anon";
GRANT ALL ON FUNCTION "public"."deduct_student_credit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."deduct_student_credit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."deduct_student_package"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deduct_student_package"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."end_session_from_webhook"("p_session_id" "uuid", "p_ended_at" timestamp with time zone, "p_duration_min" integer, "p_duration_seconds" integer, "p_event_id" "text", "p_event_type" "text", "p_room_name" "text", "p_payload_json" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."end_session_from_webhook"("p_session_id" "uuid", "p_ended_at" timestamp with time zone, "p_duration_min" integer, "p_duration_seconds" integer, "p_event_id" "text", "p_event_type" "text", "p_room_name" "text", "p_payload_json" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."end_session_with_booking"("p_session_id" "uuid", "p_actual_duration" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."end_session_with_booking"("p_session_id" "uuid", "p_actual_duration" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_homework_update_rules"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_homework_update_rules"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_forum_replies_after_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fn_forum_replies_after_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gen_invoice_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."gen_invoice_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gen_invoice_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gen_room_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."gen_room_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."gen_room_name"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_teacher_overdue_eval_count"("p_teacher_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_teacher_overdue_eval_count"("p_teacher_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_teacher_overdue_eval_count"("p_teacher_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_id_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_id_by_email"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_session"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_session"() TO "service_role";



GRANT ALL ON FUNCTION "public"."inc_teacher_sessions"() TO "anon";
GRANT ALL ON FUNCTION "public"."inc_teacher_sessions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."inc_teacher_sessions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_admin_or_mod"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin_or_mod"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_or_mod"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_or_mod"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_moderator"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_moderator"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_moderator"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_moderator"() TO "service_role";



GRANT ALL ON FUNCTION "public"."lock_confirmed_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."lock_confirmed_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_confirmed_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."lock_rate_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."lock_rate_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_rate_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."lock_refund_policy"() TO "anon";
GRANT ALL ON FUNCTION "public"."lock_refund_policy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_refund_policy"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."murajaah_due_student_ids"("p_active_since" timestamp with time zone, "p_today_start" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."murajaah_due_student_ids"("p_active_since" timestamp with time zone, "p_today_start" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."profiles_role_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profiles_role_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."profiles_role_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recompute_course_review_aggregates"("p_course_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recompute_course_review_aggregates"("p_course_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recompute_course_review_aggregates"("p_course_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_student_progress"("p_booking_id" "uuid", "p_progress_type" "text", "p_surah_from" integer, "p_ayah_from" integer, "p_surah_to" integer, "p_ayah_to" integer, "p_pages_reviewed" integer, "p_quality_rating" integer, "p_level" "text", "p_teacher_notes" "text", "p_errors" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_student_progress"("p_booking_id" "uuid", "p_progress_type" "text", "p_surah_from" integer, "p_ayah_from" integer, "p_surah_to" integer, "p_ayah_to" integer, "p_pages_reviewed" integer, "p_quality_rating" integer, "p_level" "text", "p_teacher_notes" "text", "p_errors" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."redact_pii"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."redact_pii"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."redact_pii"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."refund_package_session"("p_package_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refund_package_session"("p_package_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."restore_student_credit"() TO "anon";
GRANT ALL ON FUNCTION "public"."restore_student_credit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_student_credit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restore_student_package"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_student_package"() TO "service_role";



GRANT ALL ON TABLE "public"."session_evaluations" TO "anon";
GRANT ALL ON TABLE "public"."session_evaluations" TO "authenticated";
GRANT ALL ON TABLE "public"."session_evaluations" TO "service_role";



GRANT ALL ON FUNCTION "public"."roster_recent_evaluations"("p_teacher_id" "uuid", "p_student_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."roster_recent_evaluations"("p_teacher_id" "uuid", "p_student_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."roster_recent_evaluations"("p_teacher_id" "uuid", "p_student_ids" "uuid"[]) TO "service_role";



GRANT ALL ON TABLE "public"."student_progress" TO "anon";
GRANT ALL ON TABLE "public"."student_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."student_progress" TO "service_role";



GRANT ALL ON FUNCTION "public"."roster_recent_progress"("p_student_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."roster_recent_progress"("p_student_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."roster_recent_progress"("p_student_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_teachers"("p_needle" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_teachers"("p_needle" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_teachers"("p_needle" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_cancelled_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_cancelled_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_cancelled_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_session_from_webhook"("p_session_id" "uuid", "p_started_at" timestamp with time zone, "p_event_id" "text", "p_room_name" "text", "p_payload_json" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_session_from_webhook"("p_session_id" "uuid", "p_started_at" timestamp with time zone, "p_event_id" "text", "p_room_name" "text", "p_payload_json" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_conv_ts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_conv_ts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."teacher_at_risk_students"("p_teacher_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."teacher_at_risk_students"("p_teacher_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."teacher_at_risk_students"("p_teacher_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."teacher_distinct_students"("p_teacher_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."teacher_distinct_students"("p_teacher_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."teacher_distinct_students"("p_teacher_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."tr_course_reviews_aggregate"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_teacher_rating"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_teacher_rating"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_teacher_rating"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."user_is_session_participant"("s_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."user_is_session_participant"("s_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_is_session_participant"("s_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_booking_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_booking_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_booking_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_credits_total"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_credits_total"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_credits_total"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_session_type"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_student_progress_range"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_student_progress_range"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_student_progress_range"() TO "service_role";
























GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."automation_dead_letter" TO "anon";
GRANT ALL ON TABLE "public"."automation_dead_letter" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_dead_letter" TO "service_role";



GRANT ALL ON TABLE "public"."automation_logs" TO "anon";
GRANT ALL ON TABLE "public"."automation_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_logs" TO "service_role";



GRANT ALL ON TABLE "public"."availability_exceptions" TO "anon";
GRANT ALL ON TABLE "public"."availability_exceptions" TO "authenticated";
GRANT ALL ON TABLE "public"."availability_exceptions" TO "service_role";



GRANT ALL ON TABLE "public"."blog_posts" TO "anon";
GRANT ALL ON TABLE "public"."blog_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."blog_posts" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."class_offerings" TO "anon";
GRANT ALL ON TABLE "public"."class_offerings" TO "authenticated";
GRANT ALL ON TABLE "public"."class_offerings" TO "service_role";



GRANT ALL ON TABLE "public"."communication_preferences" TO "anon";
GRANT ALL ON TABLE "public"."communication_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."communication_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."contact_submissions" TO "anon";
GRANT ALL ON TABLE "public"."contact_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."course_enrollments" TO "anon";
GRANT ALL ON TABLE "public"."course_enrollments" TO "authenticated";
GRANT ALL ON TABLE "public"."course_enrollments" TO "service_role";



GRANT ALL ON TABLE "public"."course_lesson_progress" TO "anon";
GRANT ALL ON TABLE "public"."course_lesson_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."course_lesson_progress" TO "service_role";



GRANT ALL ON TABLE "public"."course_lessons" TO "anon";
GRANT ALL ON TABLE "public"."course_lessons" TO "authenticated";
GRANT ALL ON TABLE "public"."course_lessons" TO "service_role";



GRANT ALL ON TABLE "public"."course_payouts" TO "anon";
GRANT ALL ON TABLE "public"."course_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."course_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."course_reviews" TO "anon";
GRANT ALL ON TABLE "public"."course_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."course_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "anon";
GRANT ALL ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON TABLE "public"."daily_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."daily_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."forum_likes" TO "anon";
GRANT ALL ON TABLE "public"."forum_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."forum_likes" TO "service_role";



GRANT ALL ON TABLE "public"."forum_replies" TO "anon";
GRANT ALL ON TABLE "public"."forum_replies" TO "authenticated";
GRANT ALL ON TABLE "public"."forum_replies" TO "service_role";



GRANT ALL ON TABLE "public"."forum_reports" TO "anon";
GRANT ALL ON TABLE "public"."forum_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."forum_reports" TO "service_role";



GRANT ALL ON TABLE "public"."forum_threads" TO "anon";
GRANT ALL ON TABLE "public"."forum_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."forum_threads" TO "service_role";



GRANT ALL ON TABLE "public"."halaqa_waiting_list" TO "anon";
GRANT ALL ON TABLE "public"."halaqa_waiting_list" TO "authenticated";
GRANT ALL ON TABLE "public"."halaqa_waiting_list" TO "service_role";



GRANT ALL ON TABLE "public"."help_articles" TO "anon";
GRANT ALL ON TABLE "public"."help_articles" TO "authenticated";
GRANT ALL ON TABLE "public"."help_articles" TO "service_role";



GRANT ALL ON TABLE "public"."help_categories" TO "anon";
GRANT ALL ON TABLE "public"."help_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."help_categories" TO "service_role";



GRANT ALL ON TABLE "public"."homework_assignments" TO "anon";
GRANT ALL ON TABLE "public"."homework_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."homework_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."ijazah_pathways" TO "anon";
GRANT ALL ON TABLE "public"."ijazah_pathways" TO "authenticated";
GRANT ALL ON TABLE "public"."ijazah_pathways" TO "service_role";



GRANT ALL ON TABLE "public"."ijazah_requirements" TO "anon";
GRANT ALL ON TABLE "public"."ijazah_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."ijazah_requirements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoice_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoice_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoice_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."legal_document_versions" TO "anon";
GRANT ALL ON TABLE "public"."legal_document_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_document_versions" TO "service_role";



GRANT ALL ON TABLE "public"."legal_documents" TO "anon";
GRANT ALL ON TABLE "public"."legal_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_documents" TO "service_role";



GRANT ALL ON TABLE "public"."message_delivery_log" TO "anon";
GRANT ALL ON TABLE "public"."message_delivery_log" TO "authenticated";
GRANT ALL ON TABLE "public"."message_delivery_log" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."module_lessons" TO "anon";
GRANT ALL ON TABLE "public"."module_lessons" TO "authenticated";
GRANT ALL ON TABLE "public"."module_lessons" TO "service_role";



GRANT ALL ON TABLE "public"."modules" TO "anon";
GRANT ALL ON TABLE "public"."modules" TO "authenticated";
GRANT ALL ON TABLE "public"."modules" TO "service_role";



GRANT ALL ON TABLE "public"."notification_broadcasts" TO "anon";
GRANT ALL ON TABLE "public"."notification_broadcasts" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_broadcasts" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."packages" TO "anon";
GRANT ALL ON TABLE "public"."packages" TO "authenticated";
GRANT ALL ON TABLE "public"."packages" TO "service_role";



GRANT ALL ON TABLE "public"."parent_reports" TO "anon";
GRANT ALL ON TABLE "public"."parent_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."parent_reports" TO "service_role";



GRANT ALL ON TABLE "public"."payment_transactions" TO "anon";
GRANT ALL ON TABLE "public"."payment_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."platform_settings" TO "anon";
GRANT ALL ON TABLE "public"."platform_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_settings" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."public_profiles" TO "anon";
GRANT ALL ON TABLE "public"."public_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."public_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."quiz_attempts" TO "anon";
GRANT ALL ON TABLE "public"."quiz_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."quiz_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."quiz_question_keys" TO "anon";
GRANT ALL ON TABLE "public"."quiz_question_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."quiz_question_keys" TO "service_role";



GRANT ALL ON TABLE "public"."quiz_questions" TO "anon";
GRANT ALL ON TABLE "public"."quiz_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."quiz_questions" TO "service_role";



GRANT ALL ON TABLE "public"."quizzes" TO "anon";
GRANT ALL ON TABLE "public"."quizzes" TO "authenticated";
GRANT ALL ON TABLE "public"."quizzes" TO "service_role";



GRANT ALL ON TABLE "public"."quran_surahs" TO "anon";
GRANT ALL ON TABLE "public"."quran_surahs" TO "authenticated";
GRANT ALL ON TABLE "public"."quran_surahs" TO "service_role";



GRANT ALL ON TABLE "public"."recitation_errors" TO "anon";
GRANT ALL ON TABLE "public"."recitation_errors" TO "authenticated";
GRANT ALL ON TABLE "public"."recitation_errors" TO "service_role";



GRANT ALL ON TABLE "public"."refund_policies" TO "anon";
GRANT ALL ON TABLE "public"."refund_policies" TO "authenticated";
GRANT ALL ON TABLE "public"."refund_policies" TO "service_role";



GRANT ALL ON TABLE "public"."remote_handoff_tokens" TO "anon";
GRANT ALL ON TABLE "public"."remote_handoff_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."remote_handoff_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."resource_assignments" TO "anon";
GRANT ALL ON TABLE "public"."resource_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."resource_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."resources" TO "anon";
GRANT ALL ON TABLE "public"."resources" TO "authenticated";
GRANT ALL ON TABLE "public"."resources" TO "service_role";



GRANT ALL ON TABLE "public"."retention_signals" TO "anon";
GRANT ALL ON TABLE "public"."retention_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."retention_signals" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."schema_migrations" TO "anon";
GRANT ALL ON TABLE "public"."schema_migrations" TO "authenticated";
GRANT ALL ON TABLE "public"."schema_migrations" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."session_notes_history" TO "anon";
GRANT ALL ON TABLE "public"."session_notes_history" TO "authenticated";
GRANT ALL ON TABLE "public"."session_notes_history" TO "service_role";



GRANT ALL ON TABLE "public"."session_observers" TO "anon";
GRANT ALL ON TABLE "public"."session_observers" TO "authenticated";
GRANT ALL ON TABLE "public"."session_observers" TO "service_role";



GRANT ALL ON TABLE "public"."session_participants" TO "anon";
GRANT ALL ON TABLE "public"."session_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."session_participants" TO "service_role";



GRANT ALL ON TABLE "public"."session_presence_events" TO "anon";
GRANT ALL ON TABLE "public"."session_presence_events" TO "authenticated";
GRANT ALL ON TABLE "public"."session_presence_events" TO "service_role";



GRANT ALL ON TABLE "public"."sessions" TO "anon";
GRANT ALL ON TABLE "public"."sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."sessions" TO "service_role";



GRANT ALL ON TABLE "public"."site_announcements" TO "anon";
GRANT ALL ON TABLE "public"."site_announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."site_announcements" TO "service_role";



GRANT ALL ON TABLE "public"."site_blog_categories" TO "anon";
GRANT ALL ON TABLE "public"."site_blog_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."site_blog_categories" TO "service_role";



GRANT ALL ON TABLE "public"."site_faqs" TO "anon";
GRANT ALL ON TABLE "public"."site_faqs" TO "authenticated";
GRANT ALL ON TABLE "public"."site_faqs" TO "service_role";



GRANT ALL ON TABLE "public"."site_features" TO "anon";
GRANT ALL ON TABLE "public"."site_features" TO "authenticated";
GRANT ALL ON TABLE "public"."site_features" TO "service_role";



GRANT ALL ON TABLE "public"."student_credits" TO "anon";
GRANT ALL ON TABLE "public"."student_credits" TO "authenticated";
GRANT ALL ON TABLE "public"."student_credits" TO "service_role";



GRANT ALL ON TABLE "public"."student_ijazah_progress" TO "anon";
GRANT ALL ON TABLE "public"."student_ijazah_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."student_ijazah_progress" TO "service_role";



GRANT ALL ON TABLE "public"."student_ijazah_requirement_progress" TO "anon";
GRANT ALL ON TABLE "public"."student_ijazah_requirement_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."student_ijazah_requirement_progress" TO "service_role";



GRANT ALL ON TABLE "public"."student_packages" TO "anon";
GRANT ALL ON TABLE "public"."student_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."student_packages" TO "service_role";



GRANT ALL ON TABLE "public"."student_review_schedule" TO "anon";
GRANT ALL ON TABLE "public"."student_review_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."student_review_schedule" TO "service_role";



GRANT ALL ON TABLE "public"."study_log" TO "anon";
GRANT ALL ON TABLE "public"."study_log" TO "authenticated";
GRANT ALL ON TABLE "public"."study_log" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_availability" TO "anon";
GRANT ALL ON TABLE "public"."teacher_availability" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_availability" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_ijaza" TO "anon";
GRANT ALL ON TABLE "public"."teacher_ijaza" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_ijaza" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_languages" TO "anon";
GRANT ALL ON TABLE "public"."teacher_languages" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_languages" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_mentorship_feedback" TO "anon";
GRANT ALL ON TABLE "public"."teacher_mentorship_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_mentorship_feedback" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_mentorships" TO "anon";
GRANT ALL ON TABLE "public"."teacher_mentorships" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_mentorships" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_profiles" TO "anon";
GRANT ALL ON TABLE "public"."teacher_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_recitations" TO "anon";
GRANT ALL ON TABLE "public"."teacher_recitations" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_recitations" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_specialties" TO "anon";
GRANT ALL ON TABLE "public"."teacher_specialties" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_specialties" TO "service_role";



GRANT ALL ON TABLE "public"."v_bookings" TO "anon";
GRANT ALL ON TABLE "public"."v_bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."v_bookings" TO "service_role";



GRANT ALL ON TABLE "public"."v_evaluations" TO "anon";
GRANT ALL ON TABLE "public"."v_evaluations" TO "authenticated";
GRANT ALL ON TABLE "public"."v_evaluations" TO "service_role";



GRANT ALL ON TABLE "public"."v_homework" TO "anon";
GRANT ALL ON TABLE "public"."v_homework" TO "authenticated";
GRANT ALL ON TABLE "public"."v_homework" TO "service_role";



GRANT ALL ON TABLE "public"."v_package_effective_status" TO "anon";
GRANT ALL ON TABLE "public"."v_package_effective_status" TO "authenticated";
GRANT ALL ON TABLE "public"."v_package_effective_status" TO "service_role";



GRANT ALL ON TABLE "public"."v_progress" TO "anon";
GRANT ALL ON TABLE "public"."v_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."v_progress" TO "service_role";



GRANT ALL ON TABLE "public"."v_sessions" TO "anon";
GRANT ALL ON TABLE "public"."v_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."v_student_packages" TO "anon";
GRANT ALL ON TABLE "public"."v_student_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."v_student_packages" TO "service_role";



GRANT ALL ON TABLE "public"."v_teachers" TO "anon";
GRANT ALL ON TABLE "public"."v_teachers" TO "authenticated";
GRANT ALL ON TABLE "public"."v_teachers" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































