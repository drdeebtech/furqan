-- 20260515141058_bookings_cancel_reason_enum_split.sql
-- Closes #228.
-- Split bookings.cancel_reason (free text) into a machine-readable enum code
-- + optional free-text detail column. The original cancel_reason text column
-- is kept for backward compatibility; new code should write to the enum column.
-- This enables bucketed admin reporting and refund-eligibility rules.

create type public.booking_cancel_reason_code as enum (
  'teacher_unavailable',   -- teacher can't make the slot
  'student_request',       -- student initiated cancel
  'schedule_conflict',     -- overlaps another booking
  'technical_issue',       -- room / connectivity failure
  'admin_override',        -- admin cancelled on behalf of either party
  'package_exhausted',     -- no sessions remaining at confirm time
  'other'                  -- catch-all; must accompany cancel_reason_detail
);

alter table bookings
  add column if not exists cancel_reason_code  public.booking_cancel_reason_code,
  add column if not exists cancel_reason_detail text;
