-- Performance hardening (Supabase performance advisor, 2026-07-10).
--
-- Two behavior-preserving classes of change, both safe under expand/contract
-- (no drop/rename, no type narrowing, no NOT NULL, no default change):
--
-- 1. auth_rls_initplan (13 policies): tables added AFTER the earlier
--    `20260615150000_rls_initplan_optimize` / `20260711000000_rls_is_admin_initplan_wrap`
--    migrations were created with a bare `auth.uid()`, which Postgres
--    re-evaluates once PER ROW. Wrapping it as `(select auth.uid())` makes the
--    planner hoist it to a single initplan evaluation per query. The authZ
--    LOGIC is byte-identical — only the evaluation strategy changes. Each policy
--    is edited in place with ALTER POLICY (name/command/roles untouched).
--    Ref: https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
--
-- 2. unindexed_foreign_keys (24 constraints): FK columns with no covering index
--    force a sequential scan of the child table on parent updates/deletes and on
--    joins. Add a B-tree index per FK (IF NOT EXISTS = idempotent; leading column
--    matches the FK column order). Plain (non-CONCURRENT) CREATE INDEX because
--    migrations run in a transaction and these tables are small.
--    Ref: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

-- ────────────────────────────────────────────────────────────────────────────
-- 1. RLS initplan wrap (auth.uid() -> (select auth.uid()))
-- ────────────────────────────────────────────────────────────────────────────

-- achievements
ALTER POLICY achievements_select_own ON public.achievements
  USING ((select auth.uid()) = student_id);

ALTER POLICY achievements_select_teacher ON public.achievements
  USING (EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.student_id = achievements.student_id
      AND b.teacher_id = (select auth.uid())
  ));

-- push_subscriptions
ALTER POLICY push_subscriptions_delete_own ON public.push_subscriptions
  USING ((select auth.uid()) = user_id);

ALTER POLICY push_subscriptions_insert_own ON public.push_subscriptions
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY push_subscriptions_select_own ON public.push_subscriptions
  USING ((select auth.uid()) = user_id);

-- student_goals (own)
ALTER POLICY student_goals_delete_own ON public.student_goals
  USING ((select auth.uid()) = student_id);

ALTER POLICY student_goals_insert_own ON public.student_goals
  WITH CHECK ((select auth.uid()) = student_id);

ALTER POLICY student_goals_select_own ON public.student_goals
  USING ((select auth.uid()) = student_id);

ALTER POLICY student_goals_update_own ON public.student_goals
  USING ((select auth.uid()) = student_id)
  WITH CHECK ((select auth.uid()) = student_id);

-- student_goals (teacher, via a non-deleted booking with the student)
ALTER POLICY student_goals_teacher_insert ON public.student_goals
  WITH CHECK (EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.teacher_id = (select auth.uid())
      AND b.student_id = student_goals.student_id
      AND b.deleted_at IS NULL
  ));

ALTER POLICY student_goals_teacher_select ON public.student_goals
  USING (EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.teacher_id = (select auth.uid())
      AND b.student_id = student_goals.student_id
      AND b.deleted_at IS NULL
  ));

ALTER POLICY student_goals_teacher_update ON public.student_goals
  USING (EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.teacher_id = (select auth.uid())
      AND b.student_id = student_goals.student_id
      AND b.deleted_at IS NULL
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.teacher_id = (select auth.uid())
      AND b.student_id = student_goals.student_id
      AND b.deleted_at IS NULL
  ));

-- bookings (only the INSERT policy was still unwrapped; is_admin() subquery kept
-- exactly as-is — only the auth.uid() call is wrapped)
ALTER POLICY bookings_insert ON public.bookings
  WITH CHECK (
    (((select auth.uid()) = student_id)
      AND (status = 'pending'::booking_status)
      AND (student_package_id IS NULL))
    OR (SELECT is_admin())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Covering indexes for unindexed foreign keys
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ai_output_review_reviewed_by
  ON public.ai_output_review (reviewed_by);

CREATE INDEX IF NOT EXISTS idx_attendance_records_session_id
  ON public.attendance_records (session_id);

CREATE INDEX IF NOT EXISTS idx_daily_webhook_events_session_id
  ON public.daily_webhook_events (session_id);

CREATE INDEX IF NOT EXISTS idx_excuse_requests_decided_by
  ON public.excuse_requests (decided_by);

CREATE INDEX IF NOT EXISTS idx_monthly_reports_subscription_id
  ON public.monthly_reports (subscription_id);

CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_initiated_by
  ON public.notification_broadcasts (initiated_by);

CREATE INDEX IF NOT EXISTS idx_pending_tier_changes_from_package_id
  ON public.pending_tier_changes (from_package_id);

CREATE INDEX IF NOT EXISTS idx_pending_tier_changes_student_id
  ON public.pending_tier_changes (student_id);

CREATE INDEX IF NOT EXISTS idx_pending_tier_changes_to_package_id
  ON public.pending_tier_changes (to_package_id);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id
  ON public.quiz_attempts (quiz_id);

CREATE INDEX IF NOT EXISTS idx_resource_assignments_assigned_by
  ON public.resource_assignments (assigned_by);

CREATE INDEX IF NOT EXISTS idx_session_participants_booking_id
  ON public.session_participants (booking_id);

CREATE INDEX IF NOT EXISTS idx_student_ijazah_progress_issuing_teacher_id
  ON public.student_ijazah_progress (issuing_teacher_id);

CREATE INDEX IF NOT EXISTS idx_student_ijazah_progress_pathway_id
  ON public.student_ijazah_progress (pathway_id);

CREATE INDEX IF NOT EXISTS idx_sirp_requirement_id
  ON public.student_ijazah_requirement_progress (requirement_id);

CREATE INDEX IF NOT EXISTS idx_sirp_verifying_teacher_id
  ON public.student_ijazah_requirement_progress (verifying_teacher_id);

CREATE INDEX IF NOT EXISTS idx_student_review_schedule_progress_id
  ON public.student_review_schedule (progress_id);

CREATE INDEX IF NOT EXISTS idx_subscription_extensions_booking_id
  ON public.subscription_extensions (booking_id);

CREATE INDEX IF NOT EXISTS idx_subscription_extensions_granted_by_user_id
  ON public.subscription_extensions (granted_by_user_id);

CREATE INDEX IF NOT EXISTS idx_subscription_extensions_session_id
  ON public.subscription_extensions (session_id);

CREATE INDEX IF NOT EXISTS idx_subscription_teacher_assignments_approved_by
  ON public.subscription_teacher_assignments (approved_by);

-- composite FK fk_subscriptions_pending_tier_change (pending_tier_change_id, id)
CREATE INDEX IF NOT EXISTS idx_subscriptions_pending_tier_change
  ON public.subscriptions (pending_tier_change_id, id);

CREATE INDEX IF NOT EXISTS idx_teacher_mentorship_feedback_session_id
  ON public.teacher_mentorship_feedback (session_id);

CREATE INDEX IF NOT EXISTS idx_teacher_mentorship_feedback_written_by
  ON public.teacher_mentorship_feedback (written_by);
