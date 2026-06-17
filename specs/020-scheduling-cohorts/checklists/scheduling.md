# Scheduling & Cohort Data-Integrity Requirements Checklist

**Purpose**: Unit-test the *requirements* (not the implementation) for spec 020 scheduling, fixed-teacher assignment, and cohort/halaqa overflow — auditing requirement quality across completeness, clarity, consistency, acceptance criteria, edge coverage, non-functional, dependencies, and known ambiguities/conflicts. Items are questions about whether the spec is well-specified; they do NOT verify runtime behavior.
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md) · [contracts/api.md](../contracts/api.md)

## Completeness

- [ ] CHK001 Are the schema preconditions on `class_offerings` (program_level, schedule_json, session_duration_min, start_date, entry_conditions_json) stated as a required precondition somewhere in the functional requirements, given they are VERIFIED ABSENT in the live DB and only referenced in data-model/contracts? [Completeness, Gap — Clarifications 2026-06-16 / data-model §2c]
- [ ] CHK002 Is the *responsibility* for migrating `class_offerings` to add the 5 missing columns assigned to a requirement (FR) rather than only noted in the Clarifications Q&A and tasks? [Completeness, Gap — Clarifications 2026-06-16]
- [x] CHK003 RESOLVED (2026-06-16): per-instance materialization is now specified — data-model §2a-bis adds `teacher_availability_instances` (dated bookable instances) with per-instance `is_booked` and an idempotent generation rule; research R-004 marked superseded (lock target = dated instance); tasks add T003a (materialization migration) and change T008 `lockSlot` to lock a dated instance. Verify the body stays consistent: `is_booked` decisions read the instance, never the recurring template. [Consistency — Clarifications 2026-06-16 / data-model §2a-bis / R-004 / T003a/T008]
- [ ] CHK004 Is there a requirement covering teacher reassignment behavior **at renewal** (FR-006 only addresses reassignment generally; the spec asserts renewal as the normal change path but states no FR for renewal-driven future-session resolution)? [Completeness, Gap — FR-006 / FR-003]
- [x] CHK005 RESOLVED (2026-06-16): all four FR-021 events are now wired in tasks — `booking_created` (T009), `cohort_opened` + `member_joined` (T015), assignment created/changed (T007/T021) — all via the spec-023 typed event enum. Verify each emission point fires exactly once and `cohort_opened` fires only on an actual new-halaqa open (not sibling reuse). [Coverage — FR-021 / T009 / T015 / T021]
- [ ] CHK006 Is the disposition of legacy `halaqa_waiting_list` data specified beyond "not the overflow path" — e.g., is any requirement defined for reads/writes to it during coexistence? [Completeness, Gap — Edge Cases / Assumptions]
- [ ] CHK007 Are requirements defined for guardian-managed-child scheduling (the my-assignment contract mentions "guardian-managed child" but no FR covers guardian actors)? [Completeness, Gap — contracts §1 / FR-008]
- [ ] CHK008 Is the source and lifecycle of `current_enrollment` increments/decrements specified as a requirement (joins increment it; nothing states decrement on leave/cancel)? [Completeness, Gap — FR-013 / FR-015 / data-model §2c]
- [ ] CHK009 Does a requirement state how `lock_month` is derived/validated against the owning subscription period, or is it left to the caller's input (`YYYY-MM-01`)? [Completeness, Ambiguity — FR-003 / contracts §2]

## Clarity

- [x] CHK010 RESOLVED (2026-06-16): disambiguated to **per-dated-instance exhaustion** — `is_booked` is per `teacher_availability_instances` row (data-model §2a-bis), and a slot "locks when full" when its dated instance is booked, never the recurring weekly template. [Clarity — FR-009 / data-model §2a-bis / R-004]
- [ ] CHK011 Is "below target" vs "capacity" terminology for halaqas defined precisely (target number with no blocking minimum vs hard capacity cap), and which column each maps to? [Clarity — FR-014 / FR-015 / data-model §2c-d]
- [ ] CHK012 Is the entry-condition match rule for `entryConfirmation` defined (what constitutes "meeting" a specialist-set condition — exact token match, acknowledgement, manual review)? [Clarity, Ambiguity — FR-016 / contracts §6]
- [ ] CHK013 Is "self-select an appropriate halaqa (e.g., by juz/level)" specified with the exact selection key, given `program_level` is the sibling-match key but selection criteria for the learner are not pinned? [Clarity, Ambiguity — FR-013 / data-model §3]
- [ ] CHK014 Is the meaning of "active in-scope subscription/grant" (FR-005) defined with a checkable condition, or does it defer entirely to specs 018/019 without a verifiable predicate? [Clarity — FR-005 / Dependencies]
- [ ] CHK015 Is "no per-member slot picking" for group products stated as an enforceable rule with a defined rejection, distinct from the individual-booking path? [Clarity — FR-012 / Edge Cases "Group member tries to pick individual slots"]
- [ ] CHK016 Is the lock-window semantics ("locked to the month") defined precisely — calendar month boundary, subscription-anniversary month, or configurable? [Clarity, Ambiguity — FR-003 / Assumptions]

## Consistency

- [x] CHK017 RESOLVED (2026-06-16): data-model §0 now carries the authoritative catalog-code → enum mapping table (a-individual→hifz_individual, b→hifz_group, c→course). Verify contracts and any other artifact reference §0 rather than restating a divergent map. [Consistency — data-model §0 / Clarifications 2026-06-16 / FR-002]
- [x] CHK018 RESOLVED (2026-06-16): sibling-fill ordering is now consistent — research R-003 adds `ORDER BY current_enrollment DESC` (least-empty-first) to match data-model §3, and T004 states the same. Deterministic across all artifacts. [Consistency — Clarifications 2026-06-16 / research R-003 / data-model §3 / T004]
- [x] CHK019 RESOLVED (2026-06-16): contracts §6 step 5 now names `class_offerings.entry_conditions_json` as the single authoritative source; the `platform_settings` alternative is dropped. Consistent with data-model §2c / T018 / FR-016. [Consistency — contracts §6 / tasks T018 / FR-016]
- [ ] CHK020 Is FR-002's "student selects the teacher for individual" consistent with the assign-teacher contract that takes `teacherId` as admin/service-role input (does the student-choice flow have a defined requirement)? [Consistency, Gap — FR-002 / contracts §2]
- [x] CHK021 RESOLVED (2026-06-16): data-model §1 now documents that identity immutability is enforced by the `sta_identity_guard` BEFORE UPDATE trigger (fires for ALL roles incl. admin/service_role) — RLS `WITH CHECK` cannot express per-column immutability and is NOT the protecting mechanism. `sta_admin_update` adds `WITH CHECK (private.is_admin())` as defense-in-depth on the actor predicate only. An admin UPDATE therefore cannot evade the column guard. plan §5 mirrors this. [Consistency — data-model RLS / FR-019]
- [ ] CHK022 Is the reassignment future-booking resolution consistent between FR-006 ("re-point OR cancel") and the resolved Open Clarification + contracts (always cancel-and-rebook)? [Consistency, Conflict — FR-006 / Open Clarifications / contracts §3]
- [ ] CHK023 Is "assignment alone MUST NOT confer scheduling rights" (FR-005) consistent with the booking flow, which checks only the assignment's teacher match and not live grant eligibility at book-time? [Consistency, Gap — FR-005 / contracts §5]
- [ ] CHK024 Are the booking status values consistent across spec, data-model, and contracts (`pending`/`confirmed`/`completed`/`cancelled`/`no_show`) and used uniformly in cancellation predicates? [Consistency — data-model §2b / contracts §3]

## Acceptance Criteria

- [ ] CHK025 Are SC-001..SC-008 each tied to a measurable, falsifiable predicate (100%/0 counts) with a defined verification method, including the forged-input booking case? [Acceptance Criteria — SC-001..SC-008 / NFR-001]
- [ ] CHK026 Does an acceptance criterion exist for "no marketplace fallback when the assigned teacher publishes no availability" (Edge Case) beyond SC-002's exhaustion case? [Acceptance Criteria, Gap — Edge Cases / SC-002]
- [ ] CHK027 Is there an acceptance criterion for "below-target halaqa already started still accepts a late joiner without restarting" (distinct from SC-005 start-on-time)? [Acceptance Criteria, Gap — Edge Cases / SC-005]
- [ ] CHK028 Is there a measurable criterion for "zero duplicate sibling-cohort storm" under concurrent overflow (NFR-003 mentions it; no SC quantifies it)? [Acceptance Criteria, Gap — NFR-003 / SC-004]
- [ ] CHK029 Does SC-006 cover all three teacher-change paths (mid-month self-service rejected, after-month succeeds, admin mid-month succeeds + audited) with the approving-actor record asserted? [Acceptance Criteria — SC-006 / FR-003 / FR-004]

## Scenario / Edge Coverage

- [ ] CHK030 Is the "cohort fills mid-enrollment between seeing a seat and confirming" race covered by a requirement that prevents over-capacity insertion (not just the overflow redirect)? [Coverage — Edge Cases / FR-015 / NFR-003]
- [ ] CHK031 Is the "last open slot concurrent booking → exactly one success, no phantom debit" requirement explicit about the debit boundary (debit is in the kernel, so no debit occurs at booking creation anyway)? [Coverage, Ambiguity — FR-010 / FR-011 / Edge Cases]
- [ ] CHK032 Is "course/group student attempting to choose or change a teacher → rejected" covered as a requirement (FR-002 assigns; Edge Cases assert rejection but no FR states the self-service rejection for b/c)? [Coverage, Gap — Edge Cases / FR-002 / FR-003]
- [ ] CHK033 Is the "assignment without an active subscription must not grant scheduling rights" edge enforced at the scheduling write, not only at assignment creation? [Coverage — Edge Cases / FR-005]
- [ ] CHK034 Is the overflow path requirement explicit that overflow joiners are NEVER added to `halaqa_waiting_list`, as a checkable negative assertion? [Coverage — FR-015 / SC-004 / Edge Cases]
- [ ] CHK035 Is reassignment-with-future-bookings deterministic resolution covered for the renewal path as well as the admin path, so no future session silently references the prior teacher in either case? [Coverage, Gap — FR-006 / Edge Cases]

## Non-Functional

- [ ] CHK036 Is the SECURITY DEFINER EXECUTE lockdown requirement (NFR-002) stated for every privileged function this spec adds (`open_overflow_halaqa` and any assignment fn), with grantees enumerated? [Non-Functional — NFR-002 / data-model §3]
- [x] CHK037 RESOLVED (2026-06-16): data-model §1 clarifies the guard is per-column (`student_id`/`subscription_id`/`product_type`/`lock_month`) via the BEFORE UPDATE trigger that fires for ALL roles (no actor is exempt from the identity guard), and that `teacher_id`/`approved_by`/`is_active` are legitimately admin-mutable — reconciled, no conflict. [Non-Functional — FR-019 / data-model RLS]
- [ ] CHK038 Is race-safety (NFR-003) specified with a verification method (local Postgres concurrency simulation) for all three races: double-assignment, last-slot, overflow? [Non-Functional — NFR-003 / tasks T006]
- [ ] CHK039 Is the Arabic RTL requirement (NFR-004) attached to concrete surfaces (teacher picker, slot picker, halaqa selector, course schedule) with a `teacherNameAr` data requirement to support it? [Non-Functional — NFR-004 / plan §6 / tasks T031]
- [ ] CHK040 Is the `sb:advisors`-clean and `db:types`-regenerated requirement (FR-022 / NFR-005) scoped to the new AND changed tables, including the ALTERed `class_offerings`? [Non-Functional — FR-022 / NFR-005 / CHK001]

## Dependencies & Assumptions

- [ ] CHK041 Are the spec 018/019 dependencies (subscriptions/grants existence) stated as hard blockers with the exact tables/columns the assignment FK and eligibility check rely on? [Dependencies — Dependencies / FR-005 / data-model §1]
- [ ] CHK042 Is the assumption that the new constrained path coexists with the still-live marketplace booking captured as a requirement constraint (no removal of existing booking/availability code in this spec)? [Assumption — Assumptions / spec scope]
- [ ] CHK043 Is the assumed default individual session duration (60 min) explicitly marked as data/config to be confirmed by spec 019, not hardcoded by any requirement here? [Assumption — Assumptions]

## Ambiguities & Conflicts

- [ ] CHK044 Is the conflict between FR-002 (student chooses individual teacher) and the assign-teacher endpoint being admin/service-role-only resolved with a defined student-initiated creation flow? [Ambiguity, Conflict — FR-002 / contracts §2 / tasks T013]
- [x] CHK045 RESOLVED (2026-06-16): contracts §6 step 5 now sources entry conditions ONLY from `class_offerings.entry_conditions_json`; the `platform_settings` alternative is removed. Single authoritative source matches data-model §2c. [Ambiguity — contracts §6 / data-model §2c]
- [ ] CHK046 Is the relationship between `class_offerings.capacity`/`current_enrollment` and `sessions.capacity`/`current_enrollment`/`min_participants` disambiguated, given overflow logic uses `class_offerings` but membership and "below-target start" reference `sessions`? [Ambiguity — data-model §2c-e / FR-014 / FR-015]

## Notes

- Check items off as completed: `[x]`
- Add findings inline; `[Gap]/[Ambiguity]/[Conflict]/[Assumption]` markers flag where requirement quality is at risk.
- Highest-risk items first within each category: schema preconditions (CHK001-003), product-code/sibling-ordering consistency (CHK017-019), and admin-guard/identity conflict (CHK021/CHK037).
