-- Add covering btree indexes for the 11 foreign-key columns flagged by
-- the Supabase performance advisor's `unindexed_foreign_keys` lint.
--
-- Rationale: a foreign key without a covering index forces Postgres to
-- sequential-scan the *child* table whenever the parent row is deleted or
-- the FK column updated, AND blocks concurrent writes on the parent until
-- that scan completes. At scale this becomes a hot lock contention source.
-- Covering each FK with a btree index lets Postgres satisfy constraint
-- enforcement and JOIN planning via index lookup.
--
-- Each statement is idempotent (`if not exists`) so re-applying is safe.
-- Wrapped in a single implicit transaction; partial failure rolls back
-- the whole batch.

create index if not exists idx_legal_document_versions_saved_by   on public.legal_document_versions   (saved_by);
create index if not exists idx_session_observers_observer_id      on public.session_observers         (observer_id);
create index if not exists idx_sessions_admin_observer_id         on public.sessions                  (admin_observer_id);
create index if not exists idx_site_announcements_created_by      on public.site_announcements        (created_by);
create index if not exists idx_student_credits_payment_id         on public.student_credits           (payment_id);
create index if not exists idx_student_credits_teacher_id         on public.student_credits           (teacher_id);
create index if not exists idx_student_packages_package_id        on public.student_packages          (package_id);
create index if not exists idx_student_packages_payment_id        on public.student_packages          (payment_id);
create index if not exists idx_student_progress_booking_id        on public.student_progress          (booking_id);
create index if not exists idx_teacher_ijaza_verified_by          on public.teacher_ijaza             (verified_by);
create index if not exists idx_teacher_profiles_cv_reviewed_by    on public.teacher_profiles          (cv_reviewed_by);

-- ═════════════════════════════════════════════════════════════════════════
-- Post-checks
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare
  expected_indexes text[] := array[
    'idx_legal_document_versions_saved_by',
    'idx_session_observers_observer_id',
    'idx_sessions_admin_observer_id',
    'idx_site_announcements_created_by',
    'idx_student_credits_payment_id',
    'idx_student_credits_teacher_id',
    'idx_student_packages_package_id',
    'idx_student_packages_payment_id',
    'idx_student_progress_booking_id',
    'idx_teacher_ijaza_verified_by',
    'idx_teacher_profiles_cv_reviewed_by'
  ];
  found_count int;
begin
  -- (a) all 11 named indexes must exist on public.
  select count(*) into found_count
  from pg_indexes
  where schemaname = 'public'
    and indexname = any (expected_indexes);

  if found_count <> array_length(expected_indexes, 1) then
    raise exception 'Post-check: expected % FK covering indexes, found % in public schema',
      array_length(expected_indexes, 1), found_count;
  end if;

  raise notice 'FK covering indexes: % / % present in public schema',
    found_count, array_length(expected_indexes, 1);
end $$;
