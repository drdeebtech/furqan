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
begin
  -- Validate product type at the kernel (defense in depth; route already
  -- zod-validates). assessment/specialized flow through this creator only.
  if p_booking_product_type not in ('assessment','specialized') then
    raise exception 'invalid booking_product_type for single-session creator: %',
      p_booking_product_type using errcode = 'P0001';
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
  if p_payment_id is not null then
    update public.payments set booking_id = v_booking_id where id = p_payment_id;
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
