-- Spec 038, Phase 6 (T6.3) — "use my hours" booking source choice.
--
-- WHY. A student with BOTH an active subscription AND prepaid hours can choose,
--   per booking, which to spend. The authoritative debit is the confirm-time
--   `deduct_student_package` trigger, whose default ranking is subscription-first
--   (R2) and which knows nothing about a per-booking choice. A UI picker alone
--   would therefore LIE: it would say "using your hours" while the trigger
--   silently debited the subscription. This migration makes the choice real.
--
-- HOW (flag on the booking, honored at confirm — NOT lot-pinning). We add
--   `bookings.use_prepaid_hours` and teach the trigger's package SELECT to
--   restrict to prepaid lots when the flag is set. Lot-pinning (pre-setting
--   student_package_id) was rejected: the trigger early-returns on a pre-set
--   student_package_id WITHOUT deducting (see the "handled elsewhere" branch),
--   so pinning alone would grant a FREE session; and a pinned lot can expire /
--   be swept / be refunded between create and confirm, whereas the trigger's
--   whole value is picking a CURRENTLY-VALID lot at confirm time. The flag
--   preserves that race-safety — only the preference flips.
--
-- TRUTHFULNESS (the money-honesty bar). When the flag is set we restrict the
--   candidate set to prepaid lots ONLY. So the confirm either debits a prepaid
--   lot or — if none is valid at confirm time — hits the existing fail-closed
--   `no_package_credit` guard. It NEVER silently falls back to the subscription
--   after the student asked for hours. The create-time precondition
--   (selectActivePackage({usePrepaidHours:true})) fast-fails up front, so this
--   confirm-time failure is a rare "hours vanished during the pending window"
--   edge, not the normal path. Flag unset → the WHERE term is a tautology and
--   behavior is byte-identical to before (subscription-first).
--
-- Expand/contract: additive column (NOT NULL DEFAULT false — existing rows and
--   every other insert path keep the old behavior) + CREATE OR REPLACE of the
--   trigger function at the same signature. No DROP / RENAME / type change.
--   Sorts after 20260715000100 (the only other definer), so this body wins the
--   from-zero apply; no reconcile needed.

-- ── 1. The per-booking choice ────────────────────────────────────────────────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS use_prepaid_hours boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.use_prepaid_hours IS
  'Spec 038: student chose to spend prepaid hours (not their subscription) for '
  'this booking. Set server-side in createBooking; honored by the confirm-time '
  'deduct_student_package trigger, which restricts the charged lot to '
  'product_type=prepaid_hours when true.';

-- ── 2. Confirm-time debit honors the choice ──────────────────────────────────
-- Verbatim copy of the 20260715000100 body with ONE added WHERE term (the
-- prepaid-only restriction when new.use_prepaid_hours) and the stale
-- "pre-stamp is the override path" comment corrected — the override is now the
-- flag, and a pre-set student_package_id remains strictly the already-charged
-- early-return (it never was a deducting path).
CREATE OR REPLACE FUNCTION public.deduct_student_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg uuid;
BEGIN
  IF new.status = 'confirmed' AND old.status = 'pending' THEN
    -- One-time single-session products (spec 022) are NEVER package-funded
    -- (NFR-001/FR-007). Without this skip, a package-less student's FREE $0
    -- assessment could never be confirmed. Paid one-time bookings settle via
    -- their linked payments row, not credits.
    IF new.booking_product_type IN ('assessment','instant','specialized') THEN
      RETURN new;
    END IF;

    -- If student_package_id is already set, the charge was handled elsewhere
    -- (already-debited booking) — do nothing, to avoid a double deduct. NOTE:
    -- this is NOT the "use my hours" path. The wallet override is expressed by
    -- new.use_prepaid_hours (below); it leaves student_package_id NULL here so
    -- the trigger still performs the (race-safe) confirm-time debit.
    IF new.student_package_id IS NOT NULL THEN
      RETURN new;
    END IF;

    -- Package selection. Default (use_prepaid_hours=false): R2 ranking —
    -- subscription packages BEFORE prepaid_hours, then soonest-expiry, then
    -- oldest-purchased. Override (use_prepaid_hours=true): the added WHERE term
    -- restricts the candidate set to prepaid lots ONLY, so the student is
    -- charged prepaid hours or — if none is valid at confirm — hits the
    -- fail-closed guard below (never a silent subscription charge). The
    -- (product_type='prepaid_hours') ASC ordering is a no-op once the set is
    -- prepaid-only, and preserves subscription-first in the default case.
    -- FOR UPDATE SKIP LOCKED keeps concurrent confirms off the same package.
    SELECT id INTO v_pkg
      FROM student_packages
      WHERE student_id = new.student_id
        AND status = 'active'
        AND sessions_used < sessions_total
        AND (expires_at IS NULL OR expires_at > now())
        AND (NOT new.use_prepaid_hours OR product_type = 'prepaid_hours')
      ORDER BY (product_type = 'prepaid_hours') ASC,
               expires_at ASC NULLS LAST,
               purchased_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED;

    IF v_pkg IS NOT NULL THEN
      -- Delegate the decrement (and, for prepaid, the rolling reset + draw
      -- event) to the canonical kernel. Returns true when a row was charged.
      IF deduct_package_session(v_pkg) THEN
        -- Stamp the charged package so restore credits the SAME package (H17
        -- audit; required by H4 for wallet restore-after-expiry targeting).
        -- Touches student_package_id only — not status — so the status
        -- triggers do not re-fire.
        UPDATE bookings SET student_package_id = v_pkg WHERE id = new.id;
        RETURN new;
      END IF;
      -- Kernel reported no row charged despite the SELECT matching (the row
      -- expired or was fully used between SELECT and UPDATE). Fall through.
    END IF;

    -- Fail-closed money guard (#531). No chargeable package was found for a
    -- 1:1 confirm. Raising aborts the whole confirm_booking_with_session
    -- transaction: bookings.status update and sessions insert roll back, the
    -- booking stays 'pending', and the orchestrator surfaces
    -- BookingNoPackageError. errcode P0001 matches the TS-layer contract.
    RAISE EXCEPTION 'no_package_credit'
      USING ERRCODE = 'P0001',
            DETAIL = 'no chargeable student_packages row for student ' || new.student_id;
  END IF;
  RETURN new;
END;
$$;

ALTER FUNCTION public.deduct_student_package() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.deduct_student_package() FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.deduct_student_package() TO service_role;
