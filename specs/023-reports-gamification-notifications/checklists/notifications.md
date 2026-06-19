# Reports, Gamification & Notifications Requirements Checklist

**Purpose**: Unit-test the *requirements* (not the implementation) for the notifications, idempotency, and data layer of spec 023. Each item is a question about requirement quality — completeness, clarity, consistency, measurability, coverage — surfacing gaps, ambiguities, and conflicts before any code is written.
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [tasks.md](../tasks.md) · [data-model.md](../data-model.md) · [contracts/api.md](../contracts/api.md)

**Domain focus**: NOTIFICATIONS / IDEMPOTENCY / DATA requirement quality.

---

## Completeness

- [ ] CHK001 Is the emitter of the month-close event that triggers the monthly report (FR-002) specified, or is the requirement left to depend on an undefined upstream event? [Completeness, Gap — Clarifications §"Month-close trigger emitter"]
- [ ] CHK002 Are all six owned notification triggers (dunning/pre-suspension, expiry "continue?", payment-retry, absence/excuse outcome, report-ready, certificate-earned) each given a defined source event AND defined content requirement? [Completeness, FR-012/FR-013]
- [x] CHK003 Is the exact set of channels per trigger specified (which triggers go to in_app vs email vs whatsapp), or only that three channels exist? **RESOLVED 2026-06-16: FR-012 now defines a `trigger → channel[]` matrix (admin-configurable via `platform_settings.notification_channel_matrix`, default seed in data-model §3); SC-005 asserts the resolved `channel[]` per trigger.** [Completeness, FR-011/FR-012]
- [ ] CHK004 Are the required `automation_logs` status transitions (`started → succeeded/failed/skipped`) fully enumerated, including whether `started` is written before the side effect? [Completeness, FR-014]
- [ ] CHK005 Does the spec state what happens to a notification when a recipient (guardian) cannot be resolved from linkage — withheld, logged, or errored? [Completeness, Gap — Edge "Guardian↔student linkage ambiguity"]
- [ ] CHK006 Is the WhatsApp provider and whether pre-approved message templates are required specified, or deferred? [Completeness, Ambiguity — Clarifications §"WhatsApp provider"]
- [x] CHK007 Is a measurable formula for the honor-board "achievement/diligence metric" (FR-010) defined, or only named? **RESOLVED 2026-06-16 (marked open, not invented): FR-010 now carries an explicit ⛔ [NEEDS CLARIFICATION] marker — formula is a product decision; task T023 is BLOCKED until defined; gap confined to P2/US4, no P1 impact; SC-008 ordering claim flagged as not-yet-testable.** [Completeness, Clarifications §"Honor-board achievement metric"]
- [ ] CHK008 Does the spec define what fields constitute "display-safe" for the honor board (an explicit allow-list), rather than only an exclusion of "private contact data"? [Completeness, FR-010]
- [ ] CHK009 Is the creation of the `teacher_notes` table stated unconditionally, or conditionally ("verify against existing notes surface first") while downstream tasks assume it exists? [Completeness/Consistency, Conflict — Key Entities "Report Note"; tasks T004/T008]
- [ ] CHK010 Are retry/backoff semantics for a `failed` delivery (max attempts, delay, terminal state) specified, or only that a `failed` row is "retry-safe"? [Completeness, Gap — FR-015]

## Clarity

- [ ] CHK011 Is the notification idempotency key specified exactly once and unambiguously as `notif:{recipientId}:{trigger}:{subjectKey}`, with no competing definition elsewhere? [Clarity, Spec §Clarifications "idempotency-key schema"; FR-014]
- [ ] CHK012 Is "subject"/`subjectKey` in the notification idempotency key defined concretely per trigger (e.g. subscriptionId, bookingId, period), so two distinct triggers cannot collide? [Clarity, Ambiguity — FR-014]
- [ ] CHK013 Verify the `notifications.channel` constraint form is the array-subset `CHECK (channel <@ ARRAY[...])` and no scalar `= ANY` remains, matching the verified existing `text[]` column. RESOLVED 2026-06-16: data-model §1a, tasks T003, and research R-002 all use `<@`. [Clarity, RESOLVED — Clarifications §"channel widening"; data-model §1a; tasks T003; research R-002]
- [ ] CHK014 Is the complete widened channel set stated unambiguously as exactly {in_app, email, push, whatsapp}? [Clarity, FR-011 / Clarifications §"channel widening"]
- [x] CHK015 RESOLVED 2026-06-19: default 7 days, admin-configurable via `platform_settings.subscription_expiring_lead_days`. See FR-013 + SC-005 + Clarifications §"Session 2026-06-19". Is "sent before period end" for the expiry "continue?" prompt given a measurable lead time, or left qualitative? [Clarity, Ambiguity — FR-013/SC-005]
- [ ] CHK016 Is "Arabic-first, RTL" content quantified enough to be testable (which fields, what RTL acceptance), rather than a stylistic aspiration? [Clarity, FR-012/SC-007]
- [ ] CHK017 Is the meaning of a `skipped` outcome precisely defined as "no side effect, return success" for every idempotent path? [Clarity, FR-007/FR-014]
- [ ] CHK018 Is the scope of CR/LF stripping bounded to "subject/header / template field" and explicitly excluded from bodies, with no ambiguity about which fields are headers? [Clarity, FR-016]

## Consistency

- [ ] CHK019 Verify all artifacts agree on the notification idempotency key as the single canonical `notif:{recipientId}:{trigger}:{subjectKey}` form (FR-014, plan §1, data-model, tasks T028, contracts §7). RESOLVED 2026-06-16: contracts §7 and plan §1 rewritten to the recipient-first schema; no competing per-branch form remains. [Consistency, RESOLVED — Clarifications §"idempotency-key schema"; contracts/api.md §7; plan §1]
- [ ] CHK020 Verify contracts §7's per-branch keys conform to the canonical `notif:{recipientId}:{trigger}:{subjectKey}` ordering (recipient first, trigger second). RESOLVED 2026-06-16: all three branches (`payment_failed`, `subscription_expiring`, `absence_outcome`) now lead with `{recipientId}`. [Consistency, RESOLVED — contracts/api.md §7 vs FR-014]
- [ ] CHK021 Verify the channel CHECK form stays consistent as `<@` subset across data-model §1a, tasks T003, and research R-002. RESOLVED 2026-06-16: all scalar `= ANY` occurrences replaced with `<@`. [Consistency, RESOLVED — data-model §1a / tasks T003 / research R-002 vs Clarifications]
- [x] CHK022 Is the `certificates` table's immutability requirement (FR-020 "BEFORE UPDATE OF guard") consistent with data-model §2c which states "no guard trigger needed; no UPDATE path exists"? **RESOLVED 2026-06-16: data-model §2c rewritten — the BEFORE UPDATE OF guard IS present as defense-in-depth per FR-020/T004 (service-role/migrations exempt), even though no client UPDATE policy is granted. The contradictory "no guard needed" wording is removed.** [Consistency, FR-020 / data-model §2c]
- [ ] CHK023 Are the certificate-issuance, report-generation, and notification idempotency key prefixes (`cert:` / `report:` / `notif:`) defined once and used identically across plan, data-model, tasks, and contracts? [Consistency, plan §1; data-model §2; contracts §7]
- [x] CHK024 RESOLVED 2026-06-19: versioned append — `monthly_reports` adds `version` column + composite UNIQUE `(student_id, report_year, report_month, version)`; reads select MAX(version). See FR-002 + Clarifications §"Session 2026-06-19". Is "merged, never overwritten" (AGENTS.md §4) for out-of-order month-close events consistent with the `monthly_reports` UNIQUE(student, year, month) + append-only design — does the requirement say which row wins? [Consistency, FR-002 / Edge "Out-of-order events" / data-model §2b]
- [ ] CHK025 Are the new `FurqanEvent` member string values consistent everywhere they appear (`monthly_report_ready`, `certificate_earned`, `honor_board_updated`)? [Consistency, FR-017; data-model §4; tasks T001]

## Acceptance Criteria & Measurability

- [ ] CHK026 Is SC-004 ("0 duplicate certificates/reports/messages across 100% of retries") backed by a requirement that defines what counts as a "retry" of the same trigger? [Acceptance Criteria, SC-004/NFR-002]
- [ ] CHK027 Is SC-006 ("0 silently-succeeded false positives") tied to a concrete, observable signal (an `automation_logs.status='failed'` row + Sentry event), making it verifiable? [Acceptance Criteria, SC-006/FR-015]
- [ ] CHK028 Does SC-002 ("exactly one report and one report-ready notification per student+month, even after re-delivery") have a corresponding requirement covering both the report row AND the notification under one or separate idempotency keys? [Acceptance Criteria, SC-002/FR-002/FR-004]
- [x] CHK029 Is SC-005's "delivers on configured channels for 100% of recipients" measurable given that per-trigger channel assignment is not specified (CHK003)? **RESOLVED 2026-06-16: SC-005 rewritten to assert `notifications.channel[]` equals the FR-012 matrix default per trigger (with whatsapp dropped when disabled) — now concretely testable.** [Acceptance Criteria, SC-005/FR-011/FR-012]
- [~] CHK030 Is SC-008 ("0 private contact fields, 100% of opted-out excluded") testable against a defined display-safe field allow-list and a defined opt-out source of truth? **PARTIAL 2026-06-16: the privacy + opt-out half IS testable — display-safe allow-list = {display_name, avatar_url, achievement_metric, rank_period} (data-model §2d / research R-004); opt-out source of truth = `honor_board_entries.is_opted_out`. The *ranking/ordering* half remains NOT testable until the FR-010 metric formula is defined (see CHK007). P2/US4 only.** [Acceptance Criteria, SC-008/FR-010]

## Scenario & Edge Coverage

- [ ] CHK031 Is the webhook/n8n retry replay scenario (same trigger re-delivered → `skipped` no-op) covered as an explicit requirement, not only an acceptance scenario? [Scenario Coverage, FR-014/Edge "Duplicate trigger"]
- [x] CHK032 RESOLVED 2026-06-19: `failed` is non-terminal — `automation_logs` uses a partial UNIQUE index on `idempotency_key` `WHERE status <> 'failed'`. See Clarifications §"Session 2026-06-19". FR-014 updated. Does a requirement cover the conflict between "retry-after-failure" and the started/skipped idempotency lock — i.e. a `failed` row MAY retry while a `succeeded`/`skipped` row MUST NOT, without the lock blocking legitimate retries? [Scenario Coverage, Conflict — FR-014 vs FR-015; tasks T030]
- [ ] CHK033 Is the "n8n unreachable" path distinguished from "n8n reports failed", and do both map to `failed` (never `succeeded`) with the same retry-safety guarantee? [Scenario Coverage, FR-015/Edge "n8n unreachable"]
- [ ] CHK034 Is the WhatsApp-send-failure scenario (recorded `failed`, surfaced, retry-safe under idempotency key) specified independently of the email path? [Scenario Coverage, US5 scenario 5 / Edge]
- [ ] CHK035 Is header/template injection coverage specified for every user/teacher-authored source value (teacher note content, excuse reason) that can reach a subject/header? [Scenario Coverage, FR-016/contracts §7]
- [ ] CHK036 Is the duplicate-juz-completion (re-marked complete) scenario covered by a requirement producing no second certificate per (student, type, milestone-key)? [Scenario Coverage, FR-007/US2 scenario 2]

## Non-Functional

- [ ] CHK037 Is the fail-closed n8n callback authentication (`X-N8N-Secret` via constant-time `safeCompareSecret` before any side effect) stated as a hard requirement for every consuming branch? [Non-Functional, NFR-001/tasks T029]
- [ ] CHK038 Is the requirement that no certificate/report/notification side effect occurs once the idempotency key is present made independently testable via a replay test (NFR-002)? [Non-Functional, NFR-002]
- [ ] CHK039 Does FR-020 require BEFORE-UPDATE-OF column-level protection on the specific identity/achievement columns of `monthly_reports`, `certificates`, and `honor_board_entries`, with service-role/migrations exempt — and is the protected column list enumerated per table? [Non-Functional, FR-020/data-model §2b/§2c/§2d]
- [ ] CHK040 Is RLS-with-policies-in-the-same-migration required for every new table, with the system-generated-artifact writes constrained to service-role only? [Non-Functional, FR-018/FR-019]

## Dependencies & Assumptions

- [ ] CHK041 Are the consumed event names (`PaymentFailed`, `SubscriptionExpiring`, `AbsenceOutcome`) required to match the exact enum members emitted by specs 018/021, with a defined "stop and flag if absent" guard? [Dependencies, FR-017/tasks T001/data-model §4]
- [ ] CHK042 Is the dependency on spec 018 emitting a month-close event (currently with no defined emitter) recorded as a blocking precondition for the FR-002 user story? [Dependencies, Gap — Clarifications §"Month-close trigger emitter"]
- [ ] CHK043 Is the dependency on spec 019 for course/product definitions and the "next product" inventory stated, including the required graceful-degrade-to-null behavior when no product applies? [Dependencies, FR-006/US3 scenario 2]
- [ ] CHK044 Is the assumption that guardian↔student linkage is resolved via the existing `guardian_children` relationship (not redefined here) stated as a dependency for every guardian-scoped notification and RLS policy? [Dependencies, Assumptions §"Guardian↔student linkage"]
- [ ] CHK045 Are adjustable values (honor-board cadence/metric thresholds, WhatsApp enablement, notification copy toggles) required to live in `platform_settings` rather than hardcoded? [Dependencies, Assumptions §"Adjustable values"/data-model §3]

## Ambiguities & Conflicts

- [ ] CHK046 Is the honor-board opt-out source of truth unambiguous — `honor_board_entries.is_opted_out` vs a per-student profile flag — and consistent with "opt-out by default-visible"? [Ambiguities, Clarifications §"Honor-board opt-out"/data-model §2d]
- [x] CHK047 RESOLVED 2026-06-19: composite UNIQUE `(student_id, type, milestone_key)` with plain per-type values; type column disambiguates. See FR-007 + Clarifications §"Session 2026-06-19". Is the certificate `milestone_key` format defined unambiguously per type (juz number as text, level id, course id-as-text) so the idempotency UNIQUE(student, type, milestone_key) cannot collide across types? [Ambiguities, FR-007/data-model §2c]
- [x] CHK048 RESOLVED 2026-06-19: distinct `notif:` prefix for `monthly_report_ready`/`certificate_earned` delivery; `report:`/`cert:` issuance keys stay distinct. See Clarifications §"Session 2026-06-19". Is it unambiguous whether the "report ready" and "certificate earned" notifications use a `notif:`-prefixed key or reuse the `report:`/`cert:` issuance key — preventing a double-lock or a missed notification? [Conflict, FR-004/FR-007 vs contracts §7]

---

## Notes

- Check items off as resolved: `[x]`.
- An unchecked item is an open requirement-quality defect — record the resolution inline (e.g. spec section updated, deferred with rationale, or marked out of scope).
- Traceability tags: `Spec §ref` where the requirement exists; `[Gap]/[Ambiguity]/[Conflict]/[Assumption]` where it is missing or contested.
- Priority bias: idempotency-key consistency (CHK011, CHK019–CHK020), channel-constraint form (CHK013, CHK021), retry-vs-lock conflict (CHK032), and the month-close emitter gap (CHK001, CHK042) are the highest-risk items.
