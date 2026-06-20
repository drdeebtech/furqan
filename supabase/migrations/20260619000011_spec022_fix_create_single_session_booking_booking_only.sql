-- 20260619000011_spec022_fix_create_single_session_booking_booking_only.sql
--
-- Spec 022 follow-up. The original `create_single_session_booking`
-- (20260619000001) was authored against an imagined schema:
--   • INSERT INTO sessions (booking_id, student_id, teacher_id, scheduled_at)
--     — public.sessions has none of student_id / teacher_id / scheduled_at.
--     It is the Daily.co room table (booking_id, user_id NOT NULL,
--     room_name, room_url). Real schema:
--       bookings → no session_id column at all
--       sessions → booking_id, user_id, room_name, room_url, created_via
--       session_participants → session_id, user_id, role, booking_id
--   • UPDATE bookings SET session_id = ... — bookings has no session_id
--     column.
--
-- Design correction (architect decision, 2026-06-18): match the existing
-- working `start_instant_session_booking` pattern — insert bookings row
-- ONLY. The Daily.co session row is created lazily when the call starts
-- (same as today's instant flow). The "atomic" guarantee that actually
-- matters — booking insert + payment link in one transaction — is preserved.
-- The spec wording "booking+session+payment link in ONE transaction"
-- referred to the Daily.co session, which is created on-demand anyway, so
-- no real guarantee is lost.
--
-- Side effect of the rewrite: the unscheduled-session row that the original
-- function tried to create is dropped. Callers that read bookings via the
-- existing dashboard / sessions-list queries are unaffected (those queries
-- already handle bookings that have no linked session yet, since the
-- working instant path creates bookings without sessions today). Spec 022
-- consumers updated separately to render NULL scheduled_at as "Unscheduled".
--
-- Constitution compliance (AGENTS.md §3): SECURITY DEFINER, EXECUTE
-- lockdown unchanged (service_role only). No RLS change. Idempotent.

-- ────────────────────────────────────────────────────────────────────────────
-- Rewrite create_single_session_booking: bookings-only INSERT, payment link.
-- ────────────────────────────────────────────────────────────────────────────
-- Same signature, same lockdown, same parameter semantics. Only the body
-- changes: drop the broken sessions INSERT and the nonexistent
-- bookings.session_id UPDATE.
create or replace function public.create_single_session_booking(
  p_student_id           uuid,
  p_teacher_id           uuid,
  p_booking_product_type text,
  p_payment_id           uuid default null,
  p_specialty            text default null,
  p_purpose              specialized_purpose default null,
  p_target_scope         jsonb default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_booking_id uuid;
  v_limit      integer;
  v_count      integer;
begin
  -- Validate product type at the kernel (defense in depth; route already
  -- zod-validates). assessment/specialized flow through this creator only.
  if p_booking_product_type not in ('assessment','specialized') then
    raise exception 'invalid booking_product_type for single-session creator: %',
      p_booking_product_type using errcode = 'P0001';
  end if;

  -- FR-014 per-specialty assessment limit, enforced ATOMICALLY at the single
  -- creation chokepoint. The route's pre-charge checkAssessmentLimit() is a
  -- UX-friendly early rejection, but two concurrent checkouts can both pass it
  -- (TOCTOU: count-read then act). Serialize per (student, specialty) with a
  -- transaction-scoped advisory lock, then recount UNDER the lock, so at most
  -- `limit` active assessments can ever exist. Lock auto-releases at commit/abort.
  -- Paid path: an over-limit rejection raises here; the webhook leaves the
  -- payment recorded-but-unlinked for reconciliation (existing behaviour) —
  -- the hard limit is honoured, the charge is never silently lost.
  if p_booking_product_type = 'assessment' then
    if p_specialty is null then
      raise exception 'assessment booking requires a specialty' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(
      hashtextextended(p_student_id::text || ':' || p_specialty, 0)
    );
    -- Limit from platform_settings; missing/blank/0 → default 1 (matches the
    -- app's checkAssessmentLimit default policy).
    select coalesce(nullif(trim(value), '')::integer, 1)
      into v_limit
      from public.platform_settings
      where key = 'hifz_assessment_limit_per_specialty';
    v_limit := coalesce(v_limit, 1);
    -- Count toward the limit: same predicate as countStudentAssessmentsForSpecialty
    -- (active rows only — cancelled / no_show do not consume an attempt).
    select count(*)
      into v_count
      from public.bookings
      where student_id = p_student_id
        and booking_product_type = 'assessment'
        and specialty = p_specialty
        and status <> all (array['cancelled'::booking_status, 'no_show'::booking_status]);
    if v_count >= v_limit then
      raise exception 'assessment limit reached for specialty % (% / %)',
        p_specialty, v_count, v_limit using errcode = 'P0001';
    end if;
  end if;

  -- Booking. student_package_id is ALWAYS NULL — these products are one-time
  -- paid, never credit-funded (NFR-001 / FR-007). scheduled_at is NULL — the
  -- slot is chosen in a separate follow-up step (GET /my-bookings surfaces
  -- scheduledAt=null as "Unscheduled"). amount_usd = 0 is permitted
  -- (zero-price assessment flow); the bookings_amount_usd_check constraint
  -- was relaxed to (>= 0) in 20260619000010.
  insert into public.bookings (
    student_id, teacher_id, student_package_id,
    booking_product_type, specialty, purpose, target_scope,
    session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount,
    scheduled_at, status, teacher_confirmed
  ) values (
    p_student_id, p_teacher_id, null,
    p_booking_product_type, p_specialty, p_purpose, p_target_scope,
    'hifz', 30, 0, 0, 0, 0,
    null, 'pending', false
  )
  returning id into v_booking_id;

  -- Link the payment (no-op when p_payment_id is NULL — zero-price path).
  -- UNIQUE constraint payments_booking_id_key guarantees two bookings cannot
  -- claim the same payment.
  -- CodeRabbit #6: verify the UPDATE actually affected exactly one row.
  -- Without this check, a stale/nonexistent p_payment_id would leave the
  -- booking unlinked to any payment but the function would still return a
  -- booking id — masking the integrity violation.
  if p_payment_id is not null then
    -- `and booking_id is null` prevents reassigning an already-linked payment to
    -- a new booking; not-found then covers both nonexistent and already-linked.
    update public.payments set booking_id = v_booking_id
      where id = p_payment_id and booking_id is null;
    if not found then
      raise exception 'p_payment_id % not found or already linked — booking % rejected',
        p_payment_id, v_booking_id using errcode = 'P0002';
    end if;
  end if;

  return v_booking_id;
end;
$$;

alter function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) owner to postgres;

-- Re-assert EXECUTE lockdown under the same signature (idempotent).
revoke all on function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) from public;
revoke all on function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) from anon;
revoke all on function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) from authenticated;
grant execute on function public.create_single_session_booking(
  uuid, uuid, text, uuid, text, specialized_purpose, jsonb
) to service_role;
