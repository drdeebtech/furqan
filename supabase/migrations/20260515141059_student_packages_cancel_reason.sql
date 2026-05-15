-- 20260515141059_student_packages_cancel_reason.sql
-- Closes #243.
-- Add cancel_reason_code + cancel_reason_detail to student_packages.
-- Reuses the booking_cancel_reason_code enum from the previous migration;
-- applicable values for packages are: student_request, admin_override,
-- package_exhausted, other. Freeform cancel_reason_detail stays optional.

alter table student_packages
  add column if not exists cancel_reason_code  public.booking_cancel_reason_code,
  add column if not exists cancel_reason_detail text;
