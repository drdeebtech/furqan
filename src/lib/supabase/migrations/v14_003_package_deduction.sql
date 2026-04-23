-- ============================================================================
-- V14.3: Package Deduction Triggers
--
-- Mirrors the existing deduct_student_credit/restore_student_credit triggers
-- but operates on student_packages (V11) — the paid-entitlement system.
--
-- Without this trigger, sessions booked against a purchased package are never
-- counted against sessions_used. Once Stripe goes live students would get
-- unlimited sessions after the first booking.
--
-- Strategy: on booking confirmation, find the student's active package with
-- the soonest expiry (or nearest exhaustion), SKIP LOCKED to be race-safe,
-- increment sessions_used by 1. On cancellation of a confirmed booking,
-- decrement by 1 (clamped at 0).
-- ============================================================================

-- ─── deduct on confirmation ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION deduct_student_package()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status = 'pending' THEN
    WITH target AS (
      SELECT id FROM student_packages
      WHERE student_id = NEW.student_id
        AND status = 'active'
        AND sessions_used < sessions_total
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY expires_at ASC NULLS LAST, purchased_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE student_packages
    SET sessions_used = sessions_used + 1
    WHERE id = (SELECT id FROM target);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── restore on cancellation ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION restore_student_package()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status = 'confirmed' THEN
    WITH target AS (
      SELECT id FROM student_packages
      WHERE student_id = NEW.student_id
        AND sessions_used > 0
      ORDER BY expires_at ASC NULLS LAST, purchased_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE student_packages
    SET sessions_used = GREATEST(sessions_used - 1, 0)
    WHERE id = (SELECT id FROM target);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── wire triggers on bookings ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS t_deduct_student_package ON bookings;
CREATE TRIGGER t_deduct_student_package
  AFTER UPDATE OF status ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION deduct_student_package();

DROP TRIGGER IF EXISTS t_restore_student_package ON bookings;
CREATE TRIGGER t_restore_student_package
  AFTER UPDATE OF status ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION restore_student_package();

INSERT INTO schema_migrations (version, description)
VALUES ('14.3.0', 'V14.3: Package deduction triggers for booking confirm/cancel')
ON CONFLICT DO NOTHING;
