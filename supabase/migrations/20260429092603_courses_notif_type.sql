-- Stage 10 — extend notif_type enum with 'course' so course-related
-- notifications categorize independently of generic 'system' alerts.
--
-- ALTER TYPE ... ADD VALUE is non-blocking in Postgres 12+. Idempotent
-- by checking pg_enum first.

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'notif_type' and e.enumlabel = 'course'
  ) then
    alter type public.notif_type add value 'course';
  end if;
end $$;
