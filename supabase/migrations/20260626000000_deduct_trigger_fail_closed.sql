-- #531: make the 1:1 package-deduction trigger fail-closed.
--
-- Background: `deduct_student_package` fires AFTER bookings.status flips
-- pending→confirmed (the confirm_booking_with_session RPC). It picks a
-- chargeable student_packages row with `FOR UPDATE SKIP LOCKED` and charges
-- it. But when NO package had credit (v_pkg is null) the trigger returned
-- silently — the booking still confirmed and the student got a free
-- session. The TS layer (src/lib/domains/booking/orchestrate.ts) already
-- expects the trigger to raise `no_package_credit` and rolls back the whole
-- confirm (booking stays pending, no session row); the error class
-- BookingNoPackageError (types.ts) and its user-facing Arabic message exist
-- for exactly this case. The trigger was never updated to match that
-- contract — this closes the gap.
--
-- The raise is scoped to the 1:1 path only:
--   • group / class bookings insert directly as 'confirmed' and charge via
--     the explicit deduct_package_session RPC, not this trigger (they set
--     student_package_id up front, hitting the early-return guard).
--   • a booking whose student_package_id is already set was charged
--     elsewhere — never raise (no double-charge, guard from #346).
-- Concurrent confirms on the same package are already safe: FOR UPDATE
-- SKIP LOCKED skips a row another transaction holds, so two confirms can't
-- both charge the last credit. The race the issue describes (two creates,
-- one credit) is resolved because now BOTH confirms race for the single
-- credit — one wins (SKIP LOCKED), the other finds v_pkg null and raises
-- no_package_credit → rolls back to pending.
--
-- SECURITY DEFINER is preserved (bypasses RLS so the charge succeeds for
-- any authenticated caller); search_path pinned to public.

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
        return new;
      end if;
      -- Kernel reported no row charged despite the SELECT matching (the
      -- package expired or was fully used between SELECT and UPDATE).
      -- Fall through to the no-credit raise below.
    end if;

    -- Fail-closed money guard (#531). No chargeable package was found for a
    -- 1:1 confirm. Raising here aborts the whole confirm_booking_with_session
    -- transaction: the bookings.status update and the sessions insert both
    -- roll back, the booking stays 'pending', and the orchestrator surfaces
    -- BookingNoPackageError ("activate a package first"). Without this raise
    -- the booking would confirm and the student would receive a free session.
    -- errcode P0001 matches the TS-layer contract (orchestrate.ts checks the
    -- message substring before the generic P0001 branch).
    raise exception 'no_package_credit'
      using errcode = 'P0001',
            detail = 'no chargeable student_packages row for student ' || new.student_id;
  end if;
  return new;
end;
$$;

ALTER FUNCTION "public"."deduct_student_package"() OWNER TO "postgres";
