-- Prevent double-booking the same teacher slot at the DB level.
-- Uses a partial unique index so cancelled bookings don't block re-use of the slot.
-- Closes issue #244.
--
-- If this migration fails with a unique violation, there are existing duplicate
-- bookings that must be resolved before this constraint can be applied.
create unique index bookings_teacher_slot_unique_idx
  on bookings(teacher_id, scheduled_at)
  where status <> 'cancelled';
