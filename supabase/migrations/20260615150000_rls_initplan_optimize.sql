-- RLS performance: eliminate per-row auth re-evaluation (auth_rls_initplan).
--
-- Supabase's performance advisor flags 24 policies that call `auth.uid()` /
-- `public.is_admin_or_mod()` (and `private.teacher_has_booked_student(auth.uid(),…)`)
-- WITHOUT wrapping them in a scalar sub-select. Unwrapped, Postgres re-evaluates
-- the function for EVERY row scanned; wrapped as `(select auth.uid())` it becomes
-- a one-shot InitPlan evaluated once per query. The wrap is SEMANTICALLY IDENTICAL
-- (auth.uid()/is_admin_or_mod() are STABLE within a statement) — this changes only
-- the query plan, never who can read/write what.
--
-- Scope: the 24 `auth_rls_initplan` findings measured against a prod-faithful DB
-- (`supabase db reset` = baseline + forwards, NO legacy bootstrap layer). The
-- inflated local "60" count was a bootstrap-layering artifact. The separate
-- `multiple_permissive_policies` findings are intentionally NOT touched here —
-- merging permissive policies changes access structure and needs its own review.
--
-- Each policy is reproduced byte-for-byte from 20260428000000_remote_baseline.sql
-- with ONLY the auth-function calls wrapped. Forward migration; baseline untouched.

-- ── halaqa_waiting_list ──────────────────────────────────────────────────────
drop policy if exists "halaqa_waiting_list_delete" on "public"."halaqa_waiting_list";
create policy "halaqa_waiting_list_delete" on "public"."halaqa_waiting_list"
  for delete to "authenticated"
  using ((("student_id" = ( select "auth"."uid"() )) or (exists ( select 1
     from ("public"."sessions" "s"
       join "public"."bookings" "b" on (("b"."id" = "s"."booking_id")))
    where (("s"."id" = "b"."session_id") and ("b"."teacher_id" = ( select "auth"."uid"() ))))) or ( select "public"."is_admin_or_mod"() )));

drop policy if exists "halaqa_waiting_list_insert" on "public"."halaqa_waiting_list";
create policy "halaqa_waiting_list_insert" on "public"."halaqa_waiting_list"
  for insert to "authenticated"
  with check ((("student_id" = ( select "auth"."uid"() )) and (exists ( select 1
     from ("public"."sessions" "s"
       join "public"."bookings" "b" on (("b"."id" = "s"."booking_id")))
    where (("s"."id" = "b"."session_id") and (("b"."student_id" = ( select "auth"."uid"() )) or ("b"."teacher_id" = ( select "auth"."uid"() ))))))));

drop policy if exists "halaqa_waiting_list_select" on "public"."halaqa_waiting_list";
create policy "halaqa_waiting_list_select" on "public"."halaqa_waiting_list"
  for select to "authenticated"
  using ((("student_id" = ( select "auth"."uid"() )) or (exists ( select 1
     from ("public"."sessions" "s"
       join "public"."bookings" "b" on (("b"."id" = "s"."booking_id")))
    where (("s"."id" = "b"."session_id") and ("b"."teacher_id" = ( select "auth"."uid"() ))))) or ( select "public"."is_admin_or_mod"() )));

drop policy if exists "halaqa_waiting_list_update" on "public"."halaqa_waiting_list";
create policy "halaqa_waiting_list_update" on "public"."halaqa_waiting_list"
  for update to "authenticated"
  using (((exists ( select 1
     from ("public"."sessions" "s"
       join "public"."bookings" "b" on (("b"."id" = "s"."booking_id")))
    where (("s"."id" = "b"."session_id") and ("b"."teacher_id" = ( select "auth"."uid"() ))))) or ( select "public"."is_admin_or_mod"() )))
  with check (((exists ( select 1
     from ("public"."sessions" "s"
       join "public"."bookings" "b" on (("b"."id" = "s"."booking_id")))
    where (("s"."id" = "b"."session_id") and ("b"."teacher_id" = ( select "auth"."uid"() ))))) or ( select "public"."is_admin_or_mod"() )));

-- ── parent_reports ───────────────────────────────────────────────────────────
drop policy if exists "student_read_reports" on "public"."parent_reports";
create policy "student_read_reports" on "public"."parent_reports"
  for select
  using (("student_id" = ( select "auth"."uid"() )));

-- ── remote_handoff_tokens ────────────────────────────────────────────────────
drop policy if exists "remote_handoff_tokens_delete" on "public"."remote_handoff_tokens";
create policy "remote_handoff_tokens_delete" on "public"."remote_handoff_tokens"
  for delete to "authenticated"
  using ((("admin_user_id" = ( select "auth"."uid"() )) or ( select "public"."is_admin_or_mod"() )));

drop policy if exists "remote_handoff_tokens_insert" on "public"."remote_handoff_tokens";
create policy "remote_handoff_tokens_insert" on "public"."remote_handoff_tokens"
  for insert to "authenticated"
  with check ((("admin_user_id" = ( select "auth"."uid"() )) or ( select "public"."is_admin_or_mod"() )));

drop policy if exists "remote_handoff_tokens_select" on "public"."remote_handoff_tokens";
create policy "remote_handoff_tokens_select" on "public"."remote_handoff_tokens"
  for select to "authenticated"
  using ((("admin_user_id" = ( select "auth"."uid"() )) or ( select "public"."is_admin_or_mod"() )));

drop policy if exists "remote_handoff_tokens_update" on "public"."remote_handoff_tokens";
create policy "remote_handoff_tokens_update" on "public"."remote_handoff_tokens"
  for update to "authenticated"
  using ((("admin_user_id" = ( select "auth"."uid"() )) or ( select "public"."is_admin_or_mod"() )))
  with check ((("admin_user_id" = ( select "auth"."uid"() )) or ( select "public"."is_admin_or_mod"() )));

-- ── resource_assignments ─────────────────────────────────────────────────────
drop policy if exists "resource_assignments_admin_all" on "public"."resource_assignments";
create policy "resource_assignments_admin_all" on "public"."resource_assignments"
  using ((exists ( select 1
     from "public"."profiles" "p"
    where (("p"."id" = ( select "auth"."uid"() )) and ("p"."role" = 'admin'::"public"."user_role")))))
  with check ((exists ( select 1
     from "public"."profiles" "p"
    where (("p"."id" = ( select "auth"."uid"() )) and ("p"."role" = 'admin'::"public"."user_role")))));

drop policy if exists "resource_assignments_student_read" on "public"."resource_assignments";
create policy "resource_assignments_student_read" on "public"."resource_assignments"
  for select to "authenticated"
  using (("student_id" = ( select "auth"."uid"() )));

drop policy if exists "resource_assignments_teacher_all" on "public"."resource_assignments";
create policy "resource_assignments_teacher_all" on "public"."resource_assignments"
  to "authenticated"
  using (("assigned_by" = ( select "auth"."uid"() )))
  with check (("assigned_by" = ( select "auth"."uid"() )));

-- ── resources ────────────────────────────────────────────────────────────────
drop policy if exists "resources_teacher_own" on "public"."resources";
create policy "resources_teacher_own" on "public"."resources"
  to "authenticated"
  using (("created_by_teacher_id" = ( select "auth"."uid"() )))
  with check (("created_by_teacher_id" = ( select "auth"."uid"() )));

-- ── session_participants ─────────────────────────────────────────────────────
drop policy if exists "sp_select_self_or_teacher_or_admin" on "public"."session_participants";
create policy "sp_select_self_or_teacher_or_admin" on "public"."session_participants"
  for select to "authenticated"
  using ((("user_id" = ( select "auth"."uid"() )) or (exists ( select 1
     from ("public"."sessions" "s"
       join "public"."bookings" "b" on (("s"."booking_id" = "b"."id")))
    where (("s"."id" = "session_participants"."session_id") and ("b"."teacher_id" = ( select "auth"."uid"() ))))) or ( select "public"."is_admin_or_mod"() )));

drop policy if exists "sp_update_own_attendance_or_teacher_or_admin" on "public"."session_participants";
create policy "sp_update_own_attendance_or_teacher_or_admin" on "public"."session_participants"
  for update to "authenticated"
  using ((("user_id" = ( select "auth"."uid"() )) or (exists ( select 1
     from ("public"."sessions" "s"
       join "public"."bookings" "b" on (("s"."booking_id" = "b"."id")))
    where (("s"."id" = "session_participants"."session_id") and ("b"."teacher_id" = ( select "auth"."uid"() ))))) or ( select "public"."is_admin_or_mod"() )))
  with check ((("user_id" = ( select "auth"."uid"() )) or (exists ( select 1
     from ("public"."sessions" "s"
       join "public"."bookings" "b" on (("s"."booking_id" = "b"."id")))
    where (("s"."id" = "session_participants"."session_id") and ("b"."teacher_id" = ( select "auth"."uid"() ))))) or ( select "public"."is_admin_or_mod"() )));

-- ── student_ijazah_progress ──────────────────────────────────────────────────
drop policy if exists "student_ijazah_progress_student_read" on "public"."student_ijazah_progress";
create policy "student_ijazah_progress_student_read" on "public"."student_ijazah_progress"
  for select
  using (("student_id" = ( select "auth"."uid"() )));

drop policy if exists "student_ijazah_progress_teacher_read" on "public"."student_ijazah_progress";
create policy "student_ijazah_progress_teacher_read" on "public"."student_ijazah_progress"
  for select
  using ((exists ( select 1
     from "public"."bookings" "b"
    where (("b"."teacher_id" = ( select "auth"."uid"() )) and ("b"."student_id" = "student_ijazah_progress"."student_id") and ("b"."deleted_at" is null)))));

-- ── student_ijazah_requirement_progress ──────────────────────────────────────
drop policy if exists "student_ijazah_req_progress_student_read" on "public"."student_ijazah_requirement_progress";
create policy "student_ijazah_req_progress_student_read" on "public"."student_ijazah_requirement_progress"
  for select
  using ((exists ( select 1
     from "public"."student_ijazah_progress" "sp"
    where (("sp"."id" = "student_ijazah_requirement_progress"."student_progress_id") and ("sp"."student_id" = ( select "auth"."uid"() ))))));

drop policy if exists "student_ijazah_req_progress_teacher_read" on "public"."student_ijazah_requirement_progress";
create policy "student_ijazah_req_progress_teacher_read" on "public"."student_ijazah_requirement_progress"
  for select
  using ((exists ( select 1
     from ("public"."student_ijazah_progress" "sp"
       join "public"."bookings" "b" on (("b"."student_id" = "sp"."student_id")))
    where (("sp"."id" = "student_ijazah_requirement_progress"."student_progress_id") and ("b"."teacher_id" = ( select "auth"."uid"() )) and ("b"."deleted_at" is null)))));

drop policy if exists "student_ijazah_req_progress_teacher_write" on "public"."student_ijazah_requirement_progress";
create policy "student_ijazah_req_progress_teacher_write" on "public"."student_ijazah_requirement_progress"
  for insert
  with check ((("verifying_teacher_id" = ( select "auth"."uid"() )) and (exists ( select 1
     from ("public"."student_ijazah_progress" "sp"
       join "public"."bookings" "b" on (("b"."student_id" = "sp"."student_id")))
    where (("sp"."id" = "student_ijazah_requirement_progress"."student_progress_id") and ("b"."teacher_id" = ( select "auth"."uid"() )) and ("b"."deleted_at" is null))))));

-- ── student_packages ─────────────────────────────────────────────────────────
drop policy if exists "student_packages_teacher_read" on "public"."student_packages";
create policy "student_packages_teacher_read" on "public"."student_packages"
  for select to "authenticated"
  using ("private"."teacher_has_booked_student"(( select "auth"."uid"() ), "student_id"));

-- ── teacher_mentorship_feedback ──────────────────────────────────────────────
drop policy if exists "teacher_mentorship_feedback_mentor_write" on "public"."teacher_mentorship_feedback";
create policy "teacher_mentorship_feedback_mentor_write" on "public"."teacher_mentorship_feedback"
  for insert
  with check ((("written_by" = ( select "auth"."uid"() )) and (exists ( select 1
     from "public"."teacher_mentorships" "m"
    where (("m"."id" = "teacher_mentorship_feedback"."mentorship_id") and ("m"."mentor_id" = ( select "auth"."uid"() )) and ("m"."status" = 'active'::"text"))))));

drop policy if exists "teacher_mentorship_feedback_party_read" on "public"."teacher_mentorship_feedback";
create policy "teacher_mentorship_feedback_party_read" on "public"."teacher_mentorship_feedback"
  for select
  using ((exists ( select 1
     from "public"."teacher_mentorships" "m"
    where (("m"."id" = "teacher_mentorship_feedback"."mentorship_id") and (("m"."mentor_id" = ( select "auth"."uid"() )) or ("m"."mentee_id" = ( select "auth"."uid"() )))))));

-- ── teacher_mentorships ──────────────────────────────────────────────────────
drop policy if exists "teacher_mentorships_party_read" on "public"."teacher_mentorships";
create policy "teacher_mentorships_party_read" on "public"."teacher_mentorships"
  for select
  using ((("mentor_id" = ( select "auth"."uid"() )) or ("mentee_id" = ( select "auth"."uid"() ))));
