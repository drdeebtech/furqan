# No-Silent-Failures Audit — 2026 Q2

> Audit-only deliverable. **No `src/` source code changes in this PR.**
> Acts as the punch list for the Phase 2 remediation series. Operator
> reviews and approves before any wrapping PR opens.

**Audited at:** 2026-05-08
**Audited by:** Claude Code (Opus 4.7), against `chore/audit-no-silent-failures` branched off `main` at HEAD `7a67f18`.
**Policy reference:** [`CLAUDE.md` → "No Silent Failures Policy"](../../CLAUDE.md) — defines `loudAction`, `<ActionFeedback>`, and the three forbidden anti-pattern shapes.

---

## 1. Executive summary

| Metric | Value | Notes |
|---|---|---|
| Server-action files surveyed | **67** | 24 in `src/lib/actions/`, 43 as `src/app/**/actions.ts` (incl. `bulk-actions.ts`, `paypal-actions.ts`, `talqeen-actions.ts`, `ijaza-actions.ts`, `quick-actions.ts`) |
| Exported actions identified | **120+** | Of which ~110 mutate (insert/update/delete/upsert/RPC); ~10 read-only with side effects (signed URLs, role switches) |
| Already wrapped in `loudAction` | **17** across **9 files** | Up from the explore-agent's "4" — generic-typed `loudAction<...>(...)` calls were under-counted by an earlier grep |
| **Unwrapped writing actions (this PR's punch list)** | **~93** | The remediation surface |
| Nullish anti-patterns (raw grep) | `?? []` × 306, `?? null` × 153 | Most are *safe defensive defaults* on read paths — see §5 triage |
| `.catch(() => …)` swallows | **4** | Real silent fails. Listed in §5 |
| Empty `try { … } catch {}` blocks | **0** | Clean |
| `useActionState` callers without `<ActionFeedback>` | **28** files | Form-feedback gap. Listed in appendix §6 |
| `logError` adoption | **467** call sites | Logging primitive is mature; the gap is *plumbing it into action shells* |

**Bottom line.** The remediation effort is **~10 PRs** if grouped by domain bucket. Each wrap PR touches 6–18 actions. The biggest single concentration is `src/app/admin/teachers/[id]/actions.ts` (11 actions). The form-feedback gap is **structurally separate** from the action-wrap work and warrants its own 2–3 PR series.

---

## 2. Severity legend

| Severity | Definition | Examples |
|---|---|---|
| **P0** | Auth, role mutation, financial, data deletion. A silent fail leaks security or money. | `register`, `setUserRoles`, `softDeleteUser`, `hardDeleteUser`, `captureAndGrantPackage`, `approveCourse`, `rejectCv` |
| **P1** | Lifecycle state transitions where a silent fail strands a user/teacher in a wrong state. | `createBooking`, `endSession`, `gradeHomework`, `enrollInOffering`, `forceEndSession`, `recreateRoom`, `bulkUpdateBookingStatus` |
| **P2** | Content, settings, CMS, and best-effort writes. Silent fail is annoying but recoverable. | `savePost`, `saveService`, `togglePublished`, `updateSetting`, `saveResource`, `saveArticle` |

**Wrap order recommendation:** P0 → P1 → P2 across all domains, then form-feedback gap, then tripwire. Operator may override.

---

## 3. Wrap baseline (already on `loudAction`)

These 17 actions across 9 files are the canonical pattern. **Do not re-wrap.** Use them as templates.

| File | Wrapped action(s) | Severity |
|---|---|---|
| `src/app/admin/control-tower/quick-actions.ts` | `retryFailedAutomations`, `resolveOldestDeadLetters`, `forceEndStuckSessions` | P1 |
| `src/app/teacher/dashboard/actions.ts` | `markNoShow`, `endSession`, `extendSessionRoom`, `saveQuickNotes` | P0/P1 |
| `src/app/teacher/cv/ijaza-actions.ts` | `upsertMyIjazaBase` (exposed as `upsertMyIjaza`) | P1 |
| `src/app/admin/legal/actions.ts` | `updateLegalBase` (exposed as `updateLegal`) | P2 |
| `src/app/admin/account/actions.ts` | `updatePersonalInfoBase` (exposed as `updatePersonalInfo`) | P2 |
| `src/app/admin/content/actions.ts` | `upsertFaqBase`, `upsertFeatureBase`, `upsertCategoryBase` | P2 |
| `src/app/admin/picklists/actions.ts` | `upsertBase` (exposed as `upsertPicklistRow`) | P2 |
| `src/app/teacher/settings/actions.ts` | `updatePersonalInfoBase`, `updateTeachingStatusBase` | P2 |
| `src/app/student/settings/actions.ts` | `updatePersonalInfoBase` (exposed as `updatePersonalInfo`) | P2 |

**Pattern observation:** the established convention is `const fooBase = loudAction<...>({...})` then `export async function foo(...) { return fooBase.call(...) }` so the wrapped variant exposes a `useActionState`-compatible signature. New wrappings should follow this shape.

---

## 4. The punch list — unwrapped writing actions, by domain

Each row is one unwrapped action. **File:line** is the export site. **Surface** is the heaviest write op in the body.

### 4.1 Auth & account (P0 — wrap first)

> **Updated 2026-05-08 by PR #2 (`chore/loud-actions-auth`).** Concrete code-reading
> revealed the `(auth)/actions.ts` flows are *already* structurally loud (logError
> + recordLogin audit + BotID + rate limiting + Supabase error-code triage). Wrapping
> them in `loudAction` would regress the bespoke business-error UX. The
> remaining silent-fail surface for those three is the *form-feedback rendering*
> handled by PRs 11–13. PR #2 wraps the 3 actions where wrapping is a clear win.

| File:line | Action | Surface | Severity | PR #2 verdict | Notes |
|---|---|---|---|---|---|
| `src/app/(auth)/actions.ts:164` | `login` | RPC + auth.session | P0 | **Defer** | Already loud-by-hand: BotID, rate limit, Supabase error-code triage with tailored Arabic messages, recordLogin audit on success. `loudAction`'s catch-all model would convert expected business cases (invalid_credentials, user_banned, email_not_confirmed) into Sentry/Telegram noise. Real gap = `<ActionFeedback>` in `src/app/(auth)/login/login-form.tsx` (PR 11). |
| `src/app/(auth)/actions.ts:297` | `register` | `auth.signUp` + `profiles.insert` | P0 | **Defer** | Same pattern as `login` — the trigger-driven `profiles` insert from `private.handle_new_user()` runs server-side; UI-side audit isn't the safety net. Real gap = `<ActionFeedback>` in `register-form.tsx`. |
| `src/app/(auth)/actions.ts:416` | `forgotPassword` | `auth.resetPasswordForEmail` | P0 | **Defer** | Anti-enumeration semantics — non-existent emails return success-shaped result by design. `loudAction` would log every email's reset attempt to audit_log (privacy ding). Real gap = `<ActionFeedback>` in `forgot-form.tsx`. |
| `src/lib/actions/account.ts:13` | `updatePassword` | `auth.updateUser` | P0 | **Wrapped** ✅ | Now: Zod schema for client-side validation, `severity: "warning"`, audit on `auth.users:self`, `UserError`-tagged business throws (wrong current password) still reach audit_log as `FAILED` (security telemetry). |
| `src/lib/actions/account.ts:60` | `updateEmail` | `auth.updateUser` | P0 | **Wrapped** ✅ | Same shape as `updatePassword`. Verifies current password via admin client; throws `UserError` on mismatch. |
| `src/lib/actions/active-role.ts:30` | `switchActiveRole` | `profiles.update` + redirect | P1 | **Wrapped** ✅ | Required a 3-line patch to `loudAction`: `isRedirectError(err)` re-throws redirect throws while still writing audit_log as success (handlers that redirect have completed their work). |

**Domain bucket update:** `auth` was originally bucketed as 6 actions / 1 PR. After this PR-2 course correction:
- 3 actions wrapped (`account.ts` × 2 + `active-role.ts` × 1) plus a `loudAction` enhancement
- 3 actions deferred to the form-feedback PR series (PRs 11–13) where they actually live

### 4.2 Bookings (P0/P1 — wrap second)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/app/student/bookings/new/actions.ts:89` | `createBooking` | `bookings.insert` + n8n emit | P0 | Spec 003 owner-domain entry point |
| `src/app/teacher/dashboard/actions.ts:34` | `updateBookingStatus` | `bookings.update` | P1 | Sister of the wrapped `markNoShow` — needs wrap for parity |
| `src/app/teacher/dashboard/actions.ts:550` | `recreateRoom` | `sessions.update` + Daily.co | P1 | |
| `src/app/teacher/dashboard/actions.ts:694` | `startInstantSession` | `bookings.insert` + `sessions.insert` | P0 | Two-write transaction; double-fail-mode |
| `src/app/admin/bookings/actions.ts:38` | `adminUpdateBookingStatus` | `bookings.update` | P1 | |
| `src/app/admin/bookings/bulk-actions.ts:38` | `bulkUpdateBookingStatus` | `bookings.update` (bulk) | P1 | Bulk = high blast radius; wrap mandatory |

**Domain bucket:** `bookings` (6 actions, 1 PR)

### 4.3 Sessions & video (P1 — wrap third)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/app/teacher/sessions/[id]/actions.ts:8` | `savePostSessionNotes` | `sessions.update` + `audit_log` | P1 | Spec 003 endSession contract reference |
| `src/app/teacher/sessions/[id]/actions.ts:47` | `markNoErrorsObserved` | `sessions.update` | P1 | |
| `src/app/student/sessions/actions.ts:24` | `attestSessionHappened` | `sessions.update` | P1 | |
| `src/app/student/sessions/[id]/actions.ts:8` | `generateSessionToken` | Daily.co token mint | P1 | Token failure = student can't join |
| `src/app/student/sessions/[id]/actions.ts:74` | `submitReview` | `course_reviews.insert` | P2 | |
| `src/app/student/sessions/[id]/actions.ts:130` | `trackSessionEvent` | `automation_logs.insert` | P2 | Best-effort; ensure failure logs through `logError` not bare `.catch` |
| `src/app/admin/sessions/actions.ts:39` | `forceEndSession` | `sessions.update` | P1 | |
| `src/app/admin/sessions/actions.ts:135` | `adminCreateRoom` | Daily.co + `sessions.update` | P1 | |
| `src/app/admin/sessions/actions.ts:203` | `adminRecreateRoom` | Daily.co + `sessions.update` | P1 | |
| `src/app/admin/sessions/actions.ts:301` | `joinAsObserver` | `session_observers.insert` + Daily.co | P1 | |
| `src/lib/actions/session-lesson-plan.ts:63` | `setLessonPlan` | `sessions.update` | P2 | |
| `src/lib/actions/session-lesson-plan.ts:94` | `toggleCheckpoint` | `sessions.update` | P2 | |
| `src/lib/actions/session-lesson-plan.ts:140` | `clearLessonPlan` | `sessions.update` | P2 | |
| `src/lib/actions/group-session.ts:31` | `addStudentToSession` | `bookings.insert` (group) | P1 | |

**Domain bucket:** `sessions` (14 actions, 1 PR or split into 2)

### 4.4 Follow-up / homework (P0/P1 — wrap fourth)

The directive explicitly calls out homework. All 6 actions in `src/lib/actions/homework.ts` are listed below; **5 mutate, 1 reads** (the read uses `logError` correctly but should still gain the `loudAction` shell for audit_log of access-denied events).

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/lib/actions/homework.ts:44` | `createHomework` | `homework_assignments.insert` + n8n emit | P1 | Spec 004 owner-domain entry; lifecycle state machine starts here |
| `src/lib/actions/homework.ts:139` | `markStudentReady` | `homework_assignments.update` | P1 | State transition assigned→student_ready |
| `src/lib/actions/homework.ts:221` | `gradeHomework` | `homework_assignments.update` + auto-regen | P0 | Highest blast radius — auto-regenerates next assignment on success |
| `src/lib/actions/homework.ts:348` | `editHomework` | `homework_assignments.update` | P1 | |
| `src/lib/actions/homework.ts:446` | `getHomeworkAudioUrl` | (read only — signed URL) | P2 | Not a write; wrap for audit_log of access events |
| `src/lib/actions/homework.ts:482` | `deleteHomework` | `homework_assignments.delete` | P0 | Destructive |
| `src/app/student/sessions/talqeen-actions.ts:29` | `createTalqeenHomework` | `homework_assignments.insert` | P1 | Sister of `createHomework` for talqeen flow |
| `src/app/admin/follow-up/grade/actions.ts:42` | `bulkGradeHomework` | `homework_assignments.update` (bulk) | P0 | Bulk + grade = highest blast radius |
| `src/app/teacher/students/[studentId]/actions.ts:7` | `resolveRecitationError` | `recitation_errors.update` | P2 | |
| `src/app/teacher/students/[studentId]/actions.ts:29` | `updateSessionNotes` | `session_notes_history.insert` + `sessions.update` | P1 | |
| `src/app/teacher/recitations/actions.ts:21` | `requestFreshRecitationAction` | `homework_assignments.insert` | P1 | |

**Domain bucket:** `follow-up` (11 actions, 1 PR)

### 4.5 Packages, payments, credits (P0 — wrap fifth)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/app/(public)/packages/paypal-actions.ts:35` | `createPackageOrder` | PayPal API + `payments.insert` | P0 | Money path |
| `src/app/(public)/packages/paypal-actions.ts:138` | `captureAndGrantPackage` | PayPal capture + `student_packages.insert` + `deduct_package_session` RPC | P0 | Money path; double-write |
| `src/app/admin/packages/actions.ts:14` | `savePackage` | `packages.upsert` | P1 | |
| `src/app/admin/packages/actions.ts:89` | `deletePackage` | `packages.delete` | P0 | Destructive |
| `src/app/admin/packages/actions.ts:120` | `togglePackageActive` | `packages.update` | P1 | |
| `src/app/admin/credits/actions.ts:26` | `grantCreditAction` | `student_packages.insert` | P0 | Manual money grant; needs audit_log |
| `src/lib/actions/course-enrollments.ts:16` | `enrollFree` | `course_enrollments.insert` | P1 | |
| `src/lib/actions/course-enrollments.ts:112` | `initiateEnrollmentCheckout` | Stripe-shaped (deferred) | P0 | Will become live when Stripe ships |

**Domain bucket:** `packages` (8 actions, 1 PR)

### 4.6 Evaluations (P1)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/lib/actions/evaluations.ts:20` | `createEvaluation` | `session_evaluations.insert` | P1 | |
| `src/lib/actions/evaluations.ts:79` | `createTeacherEvaluation` | `session_evaluations.insert` | P1 | |
| `src/lib/actions/evaluations.ts:155` | `updateEvaluation` | `session_evaluations.update` | P1 | |
| `src/lib/actions/evaluations.ts:178` | `deleteEvaluation` | `session_evaluations.delete` | P0 | Destructive |

**Domain bucket:** `evaluations` (4 actions, folds into `sessions` PR if small)

### 4.7 Teacher management (P0/P1)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/app/admin/teachers/actions.ts:10` | `createTeacher` | `auth.admin.createUser` + `teacher_profiles.insert` | P0 | Double-write; uses admin client |
| `src/app/admin/teachers/actions.ts:80` | `updateTeacher` | `teacher_profiles.update` | P1 | |
| `src/app/admin/teachers/actions.ts:116` | `verifyIjaza` | `teacher_ijazas.update` + `audit_log` | P1 | |
| `src/app/admin/teachers/[id]/actions.ts:42` | `updateAccount` | `auth.admin.updateUserById` | P0 | |
| `src/app/admin/teachers/[id]/actions.ts:84` | `updateEmail` | `auth.admin.updateUserById` | P0 | |
| `src/app/admin/teachers/[id]/actions.ts:115` | `uploadTeacherPhoto` | Storage + `teacher_profiles.update` | P2 | |
| `src/app/admin/teachers/[id]/actions.ts:174` | `updateTeacherProfile` | `teacher_profiles.update` | P1 | |
| `src/app/admin/teachers/[id]/actions.ts:214` | `upsertIjaza` | `teacher_ijazas.upsert` | P1 | |
| `src/app/admin/teachers/[id]/actions.ts:275` | `deleteIjaza` | `teacher_ijazas.delete` | P1 | |
| `src/app/admin/teachers/[id]/actions.ts:300` | `setIjazaVerified` | `teacher_ijazas.update` | P1 | |
| `src/app/admin/teachers/[id]/actions.ts:335` | `upsertAvailability` | `teacher_availability.upsert` | P1 | |
| `src/app/admin/teachers/[id]/actions.ts:398` | `deleteAvailability` | `teacher_availability.delete` | P1 | |
| `src/app/admin/teachers/[id]/actions.ts:425` | `upsertException` | `availability_exceptions.upsert` | P1 | |
| `src/app/admin/teachers/[id]/actions.ts:460` | `deleteException` | `availability_exceptions.delete` | P1 | |
| `src/app/admin/teachers/cv/[teacherId]/actions.ts:14` | `saveCvAsAdmin` | `teacher_profiles.update` | P1 | |
| `src/app/admin/teachers/cv/[teacherId]/actions.ts:59` | `approveCv` | `teacher_profiles.update` + n8n emit | P0 | CV approval = onboarding gate |
| `src/app/admin/teachers/cv/[teacherId]/actions.ts:130` | `resetCvToPending` | `teacher_profiles.update` | P1 | |
| `src/app/admin/teachers/cv/[teacherId]/actions.ts:159` | `rejectCv` | `teacher_profiles.update` + n8n emit | P0 | |
| `src/app/admin/dashboard/actions.ts:8` | `toggleArchiveTeacher` | `teacher_profiles.update` | P1 | |
| `src/app/teacher/cv/actions.ts:17` | `saveCvDraft` | `teacher_profiles.update` | P2 | |
| `src/app/teacher/cv/actions.ts:58` | `submitCvForReview` | `teacher_profiles.update` + n8n emit | P1 | |
| `src/app/teacher/cv/actions.ts:81` | `saveProfilePhoto` | Storage + `teacher_profiles.update` | P2 | |
| `src/app/teacher/cv/ijaza-actions.ts:99` | `deleteMyIjaza` | `teacher_ijazas.delete` | P1 | Sister of wrapped `upsertMyIjaza` — needs wrap for parity |
| `src/app/teacher/availability/actions.ts:11` | `addSlot` | `teacher_availability.insert` | P1 | |
| `src/app/teacher/availability/actions.ts:60` | `deleteSlot` | `teacher_availability.delete` | P1 | |
| `src/app/teacher/resources/actions.ts:29` | `uploadTeacherResourceAction` | Storage + `resources.insert` | P2 | |
| `src/app/teacher/resources/actions.ts:122` | `assignResourceToStudentAction` | `resource_assignments.insert` | P2 | |
| `src/app/teacher/resources/actions.ts:216` | `deleteTeacherResourceAction` | `resources.delete` | P1 | |

**Domain bucket:** `teachers` (28 actions, **split into 2 PRs**: `teachers/admin-side` and `teachers/self-service`)

### 4.8 User management (P0)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/app/admin/users/actions.ts:18` | `toggleUserActive` | `profiles.update` | P1 | |
| `src/app/admin/users/actions.ts:73` | `setUserRoles` | `profiles.update` (`roles` array) | P0 | RLS gate |
| `src/app/admin/users/actions.ts:173` | `changeUserRole` | `profiles.update` | P0 | |
| `src/app/admin/users/actions.ts:189` | `softDeleteUser` | `profiles.update` (deleted_at) | P0 | |
| `src/app/admin/users/actions.ts:257` | `restoreUser` | `profiles.update` | P0 | |
| `src/app/admin/users/actions.ts:330` | `hardDeleteUser` | `auth.admin.deleteUser` + cascade | P0 | Highest-blast destructive |
| `src/app/admin/users/actions.ts:405` | `createUserFromScratch` | `auth.admin.createUser` + `profiles.insert` | P0 | |

**Domain bucket:** `users` (7 actions, 1 PR)

### 4.9 Notifications & messaging (P1)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/lib/actions/notifications.ts:37` | `markAsRead` | `notifications.update` | P2 | |
| `src/lib/actions/notifications.ts:59` | `markAllAsRead` | `notifications.update` (bulk) | P2 | |
| `src/lib/actions/notifications.ts:81` | `deleteNotification` | `notifications.delete` | P2 | |
| `src/app/admin/notifications/actions.ts:8` | `sendNotification` | `notifications.insert` (broadcast) | P1 | High-fanout; wrap for audit_log |
| `src/app/admin/moderation/actions.ts:53` | `hideMessage` | `messages.update` | P1 | |
| `src/app/admin/moderation/actions.ts:102` | `clearMessageFlag` | `messages.update` | P2 | |
| `src/app/admin/moderation/actions.ts:146` | `pingAdminOnEvaluation` | `notifications.insert` | P2 | |
| `src/app/admin/moderation/actions.ts:210` | `dismissEvaluation` | `session_evaluations.update` | P2 | |
| `src/app/admin/contacts/actions.ts:7` | `markAsRead` | `contact_submissions.update` | P2 | |

**Domain bucket:** `notifications` (9 mutating actions, 1 PR — folds into `admin-ops` if small)

### 4.10 Admin content & CMS (P2)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/app/admin/blog/actions.ts:19` | `savePost` | `blog_posts.upsert` | P2 | |
| `src/app/admin/blog/actions.ts:105` | `deletePost` | `blog_posts.delete` | P2 | |
| `src/app/admin/blog/actions.ts:119` | `togglePublished` | `blog_posts.update` | P2 | |
| `src/app/admin/services/actions.ts:13` | `saveService` | `services.upsert` | P2 | |
| `src/app/admin/services/actions.ts:42` | `deleteService` | `services.delete` | P2 | |
| `src/app/admin/services/actions.ts:54` | `toggleServiceActive` | `services.update` | P2 | |
| `src/app/admin/announcements/actions.ts:84` | `createAnnouncement` | `announcements.insert` | P2 | |
| `src/app/admin/announcements/actions.ts:109` | `updateAnnouncement` | `announcements.update` | P2 | |
| `src/app/admin/announcements/actions.ts:136` | `deleteAnnouncement` | `announcements.delete` | P2 | |
| `src/app/admin/announcements/actions.ts:152` | `deactivateAnnouncement` | `announcements.update` | P2 | |
| `src/app/admin/refund-policies/actions.ts:7` | `togglePolicyActive` | `refund_policies.update` | P2 | |
| `src/app/admin/reviews/actions.ts:19` | `toggleReviewPublic` | `course_reviews.update` | P2 | |
| `src/app/admin/reviews/actions.ts:33` | `deleteReview` | `course_reviews.delete` | P2 | |
| `src/app/admin/settings/actions.ts:9` | `updateSetting` | `platform_settings.upsert` | P2 | |
| `src/app/admin/picklists/actions.ts:114` | `deletePicklistRow` | `platform_picklists.delete` | P2 | |
| `src/app/admin/content/actions.ts:100` | `deleteFaq` | `faqs.delete` | P2 | |
| `src/app/admin/content/actions.ts:192` | `deleteFeature` | `features.delete` | P2 | |
| `src/app/admin/content/actions.ts:259` | `deleteCategory` | `categories.delete` | P2 | |
| `src/app/admin/retention/actions.ts:40` | `logIntervention` | `retention_signals.insert` | P2 | |
| `src/app/admin/automation/replay/actions.ts:65` | `replayAutomation` | `automation_logs.insert` + n8n trigger | P1 | |
| `src/app/admin/automation/replay/actions.ts:204` | `markDeadLetterResolved` | `dead_letter_queue.update` | P1 | |

**Domain bucket:** `admin-content` (21 actions, **split into 2 PRs**)

### 4.11 Learning surface (courses, quizzes, modules, study-log) (P1/P2)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/lib/actions/courses.ts:110` | `createCourse` | `courses.insert` | P1 | |
| `src/lib/actions/courses.ts:244` | `updateCourse` | `courses.update` | P1 | |
| `src/lib/actions/courses.ts:349` | `submitForReview` | `courses.update` | P1 | |
| `src/lib/actions/courses.ts:471` | `approveCourse` | `courses.update` + n8n | P0 | |
| `src/lib/actions/courses.ts:535` | `rejectCourse` | `courses.update` + n8n | P0 | |
| `src/lib/actions/courses.ts:600` | `archiveCourse` | `courses.update` | P1 | |
| `src/lib/actions/courses.ts:624` | `deleteCourse` | `courses.delete` | P0 | |
| `src/lib/actions/course-lessons.ts:64` | `createLesson` | `course_lessons.insert` | P1 | |
| `src/lib/actions/course-lessons.ts:157` | `updateLesson` | `course_lessons.update` | P1 | |
| `src/lib/actions/course-lessons.ts:205` | `deleteLesson` | `course_lessons.delete` | P1 | |
| `src/lib/actions/course-lessons.ts:244` | `togglePreview` | `course_lessons.update` | P2 | |
| `src/lib/actions/course-lessons.ts:274` | `syncLessonStatusFromBunny` | `course_lessons.update` | P1 | |
| `src/lib/actions/course-lessons.ts:386` | `reorderLessons` | `course_lessons.update` (bulk) | P1 | |
| `src/lib/actions/course-playback.ts:102` | `upsertLessonProgress` | `course_lesson_progress.upsert` | P2 | |
| `src/lib/actions/course-playback.ts:179` | `markLessonComplete` | `course_lesson_progress.update` | P2 | |
| `src/lib/actions/course-playback.ts:230` | `setLessonHidden` | `course_lesson_progress.update` | P2 | |
| `src/lib/actions/course-reviews.ts:19` | `writeReview` | `course_reviews.insert` | P2 | |
| `src/lib/actions/course-reviews.ts:97` | `hideReview` | `course_reviews.update` | P2 | |
| `src/lib/actions/modules.ts:39` | `createModule` | `modules.insert` | P2 | |
| `src/lib/actions/modules.ts:81` | `updateModule` | `modules.update` | P2 | |
| `src/lib/actions/modules.ts:120` | `deleteModule` | `modules.delete` | P2 | |
| `src/lib/actions/modules.ts:146` | `assignLesson` | `module_lessons.insert` | P2 | |
| `src/lib/actions/modules.ts:179` | `unassignLesson` | `module_lessons.delete` | P2 | |
| `src/lib/actions/quizzes.ts:50` | `createQuiz` | `quizzes.insert` | P2 | |
| `src/lib/actions/quizzes.ts:83` | `updateQuiz` | `quizzes.update` | P2 | |
| `src/lib/actions/quizzes.ts:113` | `deleteQuiz` | `quizzes.delete` | P2 | |
| `src/lib/actions/quizzes.ts:125` | `addQuestion` | `quiz_questions.insert` | P2 | |
| `src/lib/actions/quizzes.ts:183` | `deleteQuestion` | `quiz_questions.delete` | P2 | |
| `src/lib/actions/quizzes.ts:199` | `startQuizAttempt` | `quiz_attempts.insert` | P1 | |
| `src/lib/actions/quizzes.ts:217` | `submitQuizAttempt` | `quiz_attempts.update` | P1 | |
| `src/lib/actions/study-log.ts:28` | `startStudySession` | `study_log.insert` | P2 | |
| `src/lib/actions/study-log.ts:62` | `endStudySession` | `study_log.update` | P2 | |
| `src/lib/actions/study-log.ts:105` | `addManualEntry` | `study_log.insert` | P2 | |
| `src/lib/actions/study-log.ts:149` | `deleteStudyEntry` | `study_log.delete` | P2 | |
| `src/lib/actions/help.ts:29` | `saveArticle` | `help_articles.upsert` | P2 | |
| `src/lib/actions/help.ts:95` | `deleteArticle` | `help_articles.delete` | P2 | |
| `src/lib/actions/help.ts:112` | `togglePublished` | `help_articles.update` | P2 | |
| `src/lib/actions/resources.ts:34` | `saveResource` | `resources.upsert` | P2 | |
| `src/lib/actions/resources.ts:134` | `deleteResource` | `resources.delete` | P2 | |
| `src/lib/actions/resources.ts:151` | `toggleResourcePublished` | `resources.update` | P2 | |
| `src/lib/actions/community.ts:15` | `createThread` | `forum_threads.insert` | P2 | |
| `src/lib/actions/community.ts:46` | `createReply` | `forum_replies.insert` | P2 | |
| `src/lib/actions/community.ts:101` | `toggleLike` | `forum_likes.upsert/delete` | P2 | |
| `src/lib/actions/community.ts:134` | `reportContent` | `forum_reports.insert` | P2 | |
| `src/lib/actions/community.ts:163` | `moderateThread` | `forum_threads.update` | P2 | |
| `src/lib/actions/community.ts:194` | `moderateReply` | `forum_replies.update` | P2 | |
| `src/lib/actions/community.ts:214` | `resolveReport` | `forum_reports.update` | P2 | |
| `src/lib/actions/class-offerings.ts:28` | `createOffering` | `class_offerings.insert` | P1 | |
| `src/lib/actions/class-offerings.ts:78` | `updateOffering` | `class_offerings.update` | P1 | |
| `src/lib/actions/class-offerings.ts:161` | `enrollInOffering` | `enrollments.insert` + `deduct_package_session` RPC | P0 | Money path |
| `src/lib/actions/class-offerings.ts:290` | `cancelOffering` | `class_offerings.update` | P1 | |
| `src/lib/actions/retention-batch.ts:32` | `scoreRetentionBatch` | `retention_signals.upsert` (batch) | P1 | Cron-driven; failure = silent retention drift |

**Domain bucket:** `learning` (53 actions, **split into 3 PRs**: `courses+lessons+playback`, `quizzes+modules+study-log`, `community+class-offerings+retention`)

### 4.12 Halaqa & group sessions (P1)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/app/admin/halaqas/actions.ts:47` | `createHalaqa` | `sessions.insert` (halaqa mode) | P1 | |
| `src/app/student/halaqas/actions.ts:43` | `enrollInHalaqa` | `bookings.insert` | P1 | |
| `src/app/student/halaqas/actions.ts:142` | `cancelHalaqaEnrollment` | `bookings.update` | P1 | |
| `src/app/student/halaqas/actions.ts:217` | `joinHalaqaWaitingList` | `halaqa_waiting_list.insert` | P2 | |
| `src/app/student/halaqas/actions.ts:280` | `leaveHalaqaWaitingList` | `halaqa_waiting_list.delete` | P2 | |
| `src/app/student/group-sessions/actions.ts:24` | `requestJoinGroupSession` | `bookings.insert` | P1 | |

**Domain bucket:** `halaqa` (6 actions, folds into `bookings` PR or own PR)

### 4.13 Public-form actions (P1)

| File:line | Action | Surface | Severity | Notes |
|---|---|---|---|---|
| `src/app/(public)/contact/actions.ts:9` | `submitContactForm` | `contact_submissions.insert` | P1 | Anti-spam token already in place; loud-wrap for audit_log of failed submissions |
| `src/app/(public)/teach-with-us/apply/actions.ts:88` | `submitTeacherApplication` | `teacher_applications.insert` + Resend | P1 | Double-write coordination |

**Domain bucket:** `public-forms` (2 actions, 1 small PR)

---

## 5. Anti-pattern triage

### 5.1 Nullish coalescing (459 raw matches)

Raw grep counts overstate the silent-fail risk. Most `?? []` and `?? null` instances are **safe defensive defaults on read paths** — render an empty list instead of crashing. **Real silent fails happen on write/RPC paths** where the operation either succeeded or didn't, and `?? null` masks the difference.

**Triage rules** (apply in remediation PRs):

- **Fix** — `await supabase.from(X).insert/update/delete/upsert(...) ?? null` — the result of a write was discarded.
- **Fix** — `const { data: id } = await supabase.rpc("X").single() ?? null` — RPC return ignored.
- **Keep** — `const { data: rows } = await supabase.from(X).select(...); return rows ?? []` — read path; empty result is a valid render state.
- **Keep** — `props.items ?? []` in components — defensive default for prop unwrapping.
- **Investigate** — `?? []` on an `.eq()` filtered read where empty might mask an RLS denial. Audit the call site to confirm the empty render is correct.

### 5.2 `.catch(() => …)` swallows (4 confirmed)

The four bare-`.catch` swallows live in best-effort write paths (audit_log, dead-letter, delivery_log, automation_logs). All should become `.catch(err => logError(...))`. Exact lines to be filled in by the per-domain remediation PR — this audit is the punch list, not the diff.

### 5.3 Empty try/catch — **0 found**

Codebase is clean of fully-empty `catch {}` blocks. No action.

### 5.4 `console.error` in server actions

Spot-checked: `console.error` is rare in `src/lib/actions/` and `src/app/**/actions.ts`. The `logError` adoption (467 sites) absorbed the bulk. Remediation PRs should still grep for residual `console.error(...)` in their domain and route through `logError`.

---

## 6. Form-feedback gap (28 callers)

`useActionState` hooks the action result into a state object. Without `<ActionFeedback state={...}>`, the form silently swallows the result — *the user clicks Save, the action throws, and nothing on screen changes*. **This is the highest user-visible silent-fail surface.** It is structurally distinct from the action-wrap work and should be a parallel PR series (or one PR per surface batch).

The 28 files (full list — false positives flagged):

```
src/app/(auth)/forgot-password/forgot-form.tsx
src/app/(auth)/register/register-form.tsx
src/app/(public)/contact/contact-form.tsx
src/app/(public)/teach-with-us/apply/apply-form.tsx
src/app/admin/announcements/announcement-form.tsx
src/app/admin/blog/post-form.tsx
src/app/admin/bookings/actions.ts                        ← FALSE POSITIVE (actions.ts not a form)
src/app/admin/evaluations/new/evaluation-form.tsx
src/app/admin/halaqas/new/halaqa-form.tsx
src/app/admin/help/article-form.tsx
src/app/admin/packages/package-form.tsx
src/app/admin/resources/resource-form.tsx
src/app/admin/retention/intervention-button.tsx
src/app/admin/retention/run-scorer-button.tsx
src/app/admin/sessions/[id]/send-report-button.tsx
src/app/admin/teachers/[id]/account-form.tsx
src/app/admin/teachers/[id]/availability-editor.tsx
src/app/admin/teachers/[id]/ijazas-editor.tsx
src/app/admin/teachers/[id]/teacher-profile-form.tsx
src/app/admin/users/new/create-user-form.tsx
src/app/student/bookings/new/actions.ts                  ← FALSE POSITIVE (actions.ts not a form)
src/app/student/bookings/new/booking-form.tsx
src/app/student/halaqas/[id]/enroll-button.tsx
src/app/teacher/availability/slot-form.tsx
src/app/teacher/cv/cv-form.tsx
src/app/teacher/resources/upload-form.tsx
src/lib/sentry/before-send.test.ts                       ← FALSE POSITIVE (test fixture)
src/lib/sentry/before-send.ts                            ← FALSE POSITIVE (sentry hook, not a form)
```

**Real form-component count:** 24 (after dropping 4 false positives). Split suggestion: 3 PRs (auth+public, admin, teacher+student).

---

## 7. Proposed remediation order

Phase 2 ships as **~14 PRs** in this order. Each PR is scoped to one domain, wraps that domain's mutating actions in `loudAction`, replaces silent `.catch` with `logError`, and (where applicable) adds `<ActionFeedback>` to the rendering forms.

| # | PR title | Bucket | Action count | Severity weighted |
|---|---|---|---|---|
| 1 | `chore/loud-actions-auth` | auth & account | 6 | P0 |
| 2 | `chore/loud-actions-bookings` | bookings + halaqa | 12 | P0/P1 |
| 3 | `chore/loud-actions-sessions` | sessions + evaluations | 18 | P1 |
| 4 | `chore/loud-actions-followup` | follow-up / homework | 11 | P0/P1 |
| 5 | `chore/loud-actions-packages` | packages + payments + credits | 8 | P0 |
| 6 | `chore/loud-actions-users` | admin users | 7 | P0 |
| 7 | `chore/loud-actions-teachers-admin` | admin/teachers/* | 14 | P0/P1 |
| 8 | `chore/loud-actions-teachers-self` | teacher self-service | 14 | P1/P2 |
| 9 | `chore/loud-actions-content-cms` | admin content + announcements + blog + services | 21 | P2 |
| 10 | `chore/loud-actions-learning` | courses + lessons + quizzes + modules + community | 30+ | P1/P2 |
| 11 | `chore/feedback-renderers-auth-public` | form-feedback gap (auth, public) | 4 forms | — |
| 12 | `chore/feedback-renderers-admin` | form-feedback gap (admin) | 14 forms | — |
| 13 | `chore/feedback-renderers-teacher-student` | form-feedback gap (teacher, student) | 6 forms | — |
| 14 | `chore/silent-failures-tripwire` | grep pre-commit hook | — | — |

Operator may collapse adjacent buckets (e.g., #11–13 into one PR if small).

---

## 8. Verification before each remediation PR opens

For every wrap PR:

```bash
# 1. Pre-flight
git checkout main && git pull --ff-only && git checkout -b chore/loud-actions-<domain>
gh pr list --search "loud-actions in:title"   # avoid v2 / duplicate work
git log main --diff-filter=D --oneline -- src/<file>   # avoid re-fixing retired work

# 2. Wrap pattern (canonical, from src/app/teacher/dashboard/actions.ts)
const fooBase = loudAction<Input, { message: string }>({
  name: "<domain>.<action>",
  severity: "warning" | "critical",
  audit: { table: "<table>", recordId: i => i.id, action: "INSERT|UPDATE|DELETE" },
  handler: async (input) => { /* throws on error */ },
});
export async function foo(...args) { return fooBase.call(...) }

# 3. After
grep -c "loudAction[<(]" src/   # should grow PR-over-PR; target ≥80 by PR #10
npx next build && npm run lint && npx playwright test
```

For every form-feedback PR:

```bash
# Add <ActionFeedback state={state} /> at the top of the form, after the form opens
import { ActionFeedback } from "@/components/shared/action-feedback";
const [state, formAction] = useActionState(myAction, null);
return <form action={formAction}><ActionFeedback state={state} />...</form>;

# After
grep -c "ActionFeedback" src/   # should grow toward 45 (parity with useActionState)
```

---

## 9. Out of scope (this PR)

- Wrapping any action — the wrap PRs come next.
- Adding `<ActionFeedback>` to any form — separate PR series.
- Writing the tripwire script `scripts/lint-silent-failures.sh`.
- Phase 3 (Session Modes / Majlis).

---

## 10. Cross-references

- [`CLAUDE.md` — No Silent Failures Policy](../../CLAUDE.md)
- [`src/lib/actions/loud.ts`](../../src/lib/actions/loud.ts) — `loudAction` source
- [`src/components/shared/action-feedback.tsx`](../../src/components/shared/action-feedback.tsx) — `<ActionFeedback>` source
- [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) — five-principle constitution; "loud failures" principle aligns with this audit
- Spec 003 (booking lifecycle), Spec 004 (follow-up lifecycle), Spec 005 (package deduction) — already merged via PRs #226 / #231 / #238; their owner-domain entry points are listed in §4.2 / §4.4 / §4.5

---

*Audit complete. Operator approval required before any remediation PR opens.*
