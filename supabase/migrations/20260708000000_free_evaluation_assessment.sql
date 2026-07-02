-- 20260708000000_free_evaluation_assessment.sql
--
-- Trust roadmap Wave 2 / E1 (decisions 40 + G5, plan shimmering-cray-2).
-- The free 30-minute evaluation session REUSES the spec-022 'assessment'
-- single-session product — which already ships $0 default price
-- (platform_settings), hardcoded 30-min duration, unscheduled creation,
-- advisory-locked limit checks, and "cancelled/no_show don't consume the
-- attempt" semantics — instead of introducing a parallel is_evaluation
-- flag that would duplicate a live free-session product. Two gaps close:
--
-- 1. deduct_student_package() had no carve-out for one-time single-session
--    products. An 'assessment' booking (student_package_id NULL by design —
--    spec 022 NFR-001/FR-007: one-time products are NEVER credit-funded)
--    transitioning pending→confirmed fell into the package search and, for
--    any student without an active package, raised no_package_credit — so
--    the FREE evaluation could never be confirmed. Skip the debit for the
--    three one-time product types. Their money integrity is enforced
--    elsewhere: assessment/specialized require a linked payment when the
--    configured price > 0 (create_single_session_booking), instant debits
--    atomically inside start_instant_session_booking (and inserts as
--    'confirmed', so this trigger path never charges it anyway), and the
--    confirm-time guard already exempts amount_usd = 0 rows — 20260615130000
--    anticipated exactly this genuinely-free case. The package path
--    (booking_product_type IS NULL) keeps the fail-closed raise unchanged.
--
-- 2. Decision 40 caps the free evaluation at ONE active assessment per
--    student ACROSS specialties (re-book allowed after cancel/no-show — G5).
--    The spec-022 per-(student,specialty) limit alone would grant one free
--    assessment per specialty. A partial unique index is the race-proof
--    backstop; the checkout route adds the friendly 409 pre-check. On the
--    paid path a race rejection leaves the payment recorded-but-unlinked
--    for reconciliation (existing creator behaviour, unchanged).
--
-- Expand/contract compliant: additive only (function widens — strictly
-- fewer raises; new partial index). No RLS change, no column change.
-- Idempotent.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. deduct_student_package(): skip one-time single-session products
-- ────────────────────────────────────────────────────────────────────────────
-- Body identical to 20260626000000 except the product-type skip at the top
-- of the pending→confirmed branch.
CREATE OR REPLACE FUNCTION "public"."deduct_student_package"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_pkg uuid;
begin
  if new.status = 'confirmed' and old.status = 'pending' then
    -- One-time single-session products (spec 022) are NEVER package-funded
    -- (NFR-001/FR-007). Without this skip, a package-less student's FREE
    -- $0 assessment (trust roadmap E1) could never be confirmed — the
    -- package search below would raise no_package_credit. Paid one-time
    -- bookings settle via their linked payments row, not credits.
    if new.booking_product_type in ('assessment','instant','specialized') then
      return new;
    end if;

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

-- ────────────────────────────────────────────────────────────────────────────
-- 2. One active assessment per student (decision 40, G5)
-- ────────────────────────────────────────────────────────────────────────────
-- Race-proof backstop for the route-level 409 pre-check. Excludes
-- cancelled/no_show rows — same predicate as the creator's limit count —
-- so a student whose evaluation was cancelled or no-showed can re-book.
create unique index if not exists uniq_active_assessment_per_student
  on public.bookings (student_id)
  where booking_product_type = 'assessment'
    and status <> all (array['cancelled'::booking_status, 'no_show'::booking_status]);

comment on index public.uniq_active_assessment_per_student is
  'Trust roadmap E1 / decision 40: at most ONE active free-evaluation (assessment) booking per student across specialties. Cancelled/no_show rows are excluded so re-booking is allowed (G5).';
