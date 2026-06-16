-- Atomic instant-session debit + booking insert (audit Fix 2).
--
-- Problem: startInstantSession (src/lib/domains/session/orchestrate.ts) debited a
-- package (deduct_package_session RPC — COMMITS) and THEN inserted the bookings
-- row as two separate, non-transactional statements. If the INSERT failed and
-- the action was retried, the retry re-selected the soonest-expiry package and
-- could debit a DIFFERENT package — double-charging one session. The compensating
-- cancel only ran if the booking row already existed.
--
-- Fix: do the package SELECT-for-update, the debit, and the booking INSERT in ONE
-- SECURITY DEFINER function / transaction. If the INSERT fails, the debit rolls
-- back with it — no orphaned charge, and a retry cannot double-charge. Mirrors the
-- confirm_booking_with_session atomic pattern.
--
-- Selection logic is identical to the deduct_student_package trigger (soonest
-- expiry, credit remaining, FOR UPDATE SKIP LOCKED so concurrent instant sessions
-- don't race onto the same package). The booking is inserted as 'confirmed' with
-- student_package_id stamped (so a later cancellation restores THIS package via
-- restore_student_package). Inserting status='confirmed' does NOT double-charge:
-- deduct_student_package fires only on AFTER UPDATE OF status (pending->confirmed),
-- never on INSERT.
--
-- SECURITY DEFINER + service_role-only EXECUTE (matches deduct_package_session):
-- the caller is the server-side admin client; students cannot charge packages.
-- Forward migration only; the baseline is never edited.

create or replace function "public"."start_instant_session_booking"(
  "p_student_id" "uuid",
  "p_teacher_id" "uuid",
  "p_session_type" "public"."session_type",
  "p_duration_min" integer,
  "p_rate_snapshot" numeric,
  "p_amount_usd" numeric,
  "p_scheduled_at" timestamp with time zone
) returns "uuid"
    language "plpgsql"
    security definer
    set "search_path" to 'pg_catalog', 'public'
    as $$
declare
  v_pkg uuid;
  v_booking_id uuid;
begin
  -- Soonest-expiry active package with credit, locked. Same predicate/order as
  -- the deduct_student_package trigger. SKIP LOCKED prevents two concurrent
  -- instant sessions from racing onto the same package row.
  select id into v_pkg
  from public.student_packages
  where student_id = p_student_id
    and status = 'active'
    and sessions_used < sessions_total
    and (expires_at is null or expires_at > now())
  order by expires_at asc nulls last, purchased_at asc
  limit 1
  for update skip locked;

  if v_pkg is null then
    raise exception 'no_active_package'
      using errcode = 'P0001',
            detail = 'no active package with remaining credit for student ' || p_student_id;
  end if;

  -- Debit via the canonical kernel (one mutation rule for every debit path).
  -- Returns false when the package guard failed between selection and debit.
  if not public.deduct_package_session(v_pkg) then
    raise exception 'package_debit_failed'
      using errcode = 'P0001',
            detail = 'deduct_package_session returned false for package ' || v_pkg;
  end if;

  -- Insert the already-confirmed booking in the SAME transaction. If this fails
  -- (e.g. no_booking_overlap, NOT NULL), the debit above rolls back — no charge
  -- without a booking, and a retry cannot double-charge.
  insert into public.bookings (
    student_id, teacher_id, session_type, duration_min, rate_snapshot,
    amount_usd, scheduled_at, status, teacher_confirmed, teacher_confirmed_at,
    student_package_id
  ) values (
    p_student_id, p_teacher_id, p_session_type, p_duration_min, p_rate_snapshot,
    p_amount_usd, p_scheduled_at, 'confirmed', true, p_scheduled_at, v_pkg
  )
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

-- Lock down EXECUTE to service_role ONLY. Supabase's ALTER DEFAULT PRIVILEGES
-- grants EXECUTE on new public functions to anon + authenticated, and
-- `revoke from public` does NOT strip those role-level grants — so we must
-- revoke from anon + authenticated explicitly, or a student could call this
-- SECURITY DEFINER fn directly and charge any package / forge bookings.
revoke all on function "public"."start_instant_session_booking"("uuid", "uuid", "public"."session_type", integer, numeric, numeric, timestamp with time zone) from public;
revoke all on function "public"."start_instant_session_booking"("uuid", "uuid", "public"."session_type", integer, numeric, numeric, timestamp with time zone) from anon;
revoke all on function "public"."start_instant_session_booking"("uuid", "uuid", "public"."session_type", integer, numeric, numeric, timestamp with time zone) from authenticated;
grant execute on function "public"."start_instant_session_booking"("uuid", "uuid", "public"."session_type", integer, numeric, numeric, timestamp with time zone) to "service_role";
