# Single-Session Payments Security Requirements Checklist

**Purpose**: Quality-gate the *requirements* for spec 022's one-time-paid single-session products through a payments-security / fail-closed lens — auditing whether the spec, plan, data-model, and contracts express their money-handling, fail-closed, and no-debit obligations clearly, completely, consistently, and measurably. This is a "unit test for the requirements," not a verification of code.
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md) · [contracts/api.md](../contracts/api.md)

**Note**: Each item is a question about requirement quality. Answer YES (requirement is sound) or NO (gap/defect to fix in the spec). Items are risk-prioritized: fail-closed, no-debit, and the service-role guard idiom lead.

## Fail-Closed & No-Debit Invariants (highest risk)

- [ ] CHK001 Is "no session may be materialized before the one-time payment is confirmed" stated as a single, testable invariant that names *every* code path it binds (zero-price direct-create, instant atomic fn, assessment/specialized webhook INSERT)? [Completeness, Spec §NFR-001/FR-008]
- [ ] CHK002 Is the fail-closed requirement measurable — does it define the observable success condition (0 sessions created for an unconfirmed/abandoned/failed payment) rather than a behavioral assertion? [Acceptance Criteria, Spec §SC-004]
- [ ] CHK003 Does the zero-price ("free assessment") path have its own explicitly-stated requirement reconciling it with fail-closed — i.e. that creating a session with *no* confirmed payment is the intended exception, not a violation of NFR-001? [Clarity, Spec §FR-003/NFR-001]
- [ ] CHK004 Is the no-debit invariant ("MUST NOT debit `student_packages` / consume subscription credit") stated as a requirement that binds all three products on all paths, including the adapted `start_instant_session_booking`? [Completeness, Spec §FR-007/NFR-001]
- [ ] CHK005 Is the no-debit invariant given a measurable acceptance criterion (e.g. "zero `student_packages` debits" / "credit balance unchanged in 100%") rather than only prose? [Acceptance Criteria, Spec §SC-001/SC-002]
- [ ] CHK006 Is the requirement that a subscriber with available credits is *still* charged the one-time price (never silently credit-funded) explicitly stated as a non-negotiable, not merely an edge case? [Completeness, Spec §FR-007 / Edge Cases]

## Service-Role Guard Idiom (consistency — known defect)

- [ ] CHK007 Does the spec require the single-session identity guard's service-role detection to use the VERIFIED canonical idiom `nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='service_role'`, treating a NULL/empty JWT as a trusted direct-DB/migration write? [Consistency, Spec §Clarifications 2026-06-16]
- [ ] CHK008 Does data-model.md's guard function definition CONFLICT with the resolved clarification — it specifies `current_setting('role') = 'service_role'`, the idiom the clarification explicitly forbids as reading the wrong GUC? [Conflict, data-model.md §2 vs Spec §Clarifications]
- [ ] CHK009 Is the requirement explicit that, with the wrong GUC, the service-role exemption would *never match* — so every service-role/migration write would be blocked by its own guard (fail-closed-to-broken)? [Clarity, Spec §Clarifications]
- [ ] CHK010 Is "match the idiom used by existing guard migrations" stated as a binding consistency requirement (not just a note), so the guard does not diverge from the platform-wide convention? [Consistency, Spec §FR-018]
- [ ] CHK011 Does the requirement specify the admin-exemption mechanism (`private.is_admin()`) and migration-exemption precisely enough that the guard cannot be silently bypassed via a mutable column the guard does not read? [Completeness, Spec §FR-018]

## booking_product_type / Legacy NULL Invariant

- [ ] CHK012 Is the "NULL `booking_product_type` = legacy credit-funded" invariant stated as a requirement that reporting AND RLS must honor (not only a prose aside in Clarifications)? [Completeness, Spec §Clarifications]
- [ ] CHK013 Is it specified that the column is added by this spec and absent today, so existing rows become NULL — and is the back-fill/interpretation rule for those NULL rows unambiguous? [Clarity, Spec §Clarifications / data-model.md §2]
- [ ] CHK014 Does the `CHECK (booking_product_type IN ('assessment','instant','specialized','subscription'))` constraint reconcile with "legacy rows are NULL" — i.e. is NULL explicitly permitted by the constraint and reporting? [Consistency, data-model.md §2 vs Spec §Clarifications]
- [ ] CHK015 Is there a requirement that single-session RLS / reconciliation queries distinguish one-time-paid rows from NULL-legacy rows so a legacy row is never mis-counted as one-time-paid (or vice versa)? [Completeness, Spec §SC-001]

## Atomic Booking+Session Creation & Recovery (exception coverage)

- [ ] CHK016 Does the spec require an atomic SECURITY DEFINER creator (booking + session in one transaction) for assessment and specialized bookings — explicitly forbidding a bare INSERT in the webhook handler? [Completeness, Spec §Clarifications]
- [ ] CHK017 Does this atomic-creator requirement CONFLICT with contracts/api.md and tasks.md, which still describe webhook-side `INSERT into bookings + sessions` (T013/T019, contract §3) rather than calling an atomic creator? [Conflict, contracts/api.md §3 / tasks.md T013,T019 vs Spec §Clarifications]
- [ ] CHK018 Is the "payment confirmed but session creation fails" path defined as a requirement with a concrete recovery outcome (idempotent retry completes, OR a recorded reconcilable/refundable failure) rather than left to "must not silently vanish" prose? [Scenario/Edge Coverage, Spec §Edge Cases]
- [ ] CHK019 Is the charge-but-no-specialist outcome (FR-013) specified with a decision rule on ordering — fail-before-charge (no charge taken) vs charge-then-refund/reconcile — rather than offering both as undifferentiated alternatives? [Ambiguity, Spec §FR-013 / Edge Cases]
- [ ] CHK020 Is a refund/reconciliation requirement actually defined anywhere (who initiates it, against what ledger, in what time bound), or is FR-013's "reconcilable/refundable per 018" an unbacked reference with no owning requirement? [Gap, Spec §FR-013]
- [ ] CHK021 Is idempotency specified as a measurable requirement — "at most one session and one payment per intent" keyed on a named idempotency key (`pi_{id}` in `billing_events`) — for ALL three products, not just instant? [Acceptance Criteria, Spec §FR-010/SC-005]

## Pricing / Configuration Requirements (measurability)

- [ ] CHK022 Is "prices are configuration data, never hardcoded" stated as a verifiable requirement (e.g. read at booking time from `platform_settings`, with a definable check) rather than an aspiration? [Clarity, Spec §FR-002]
- [ ] CHK023 Is the risk of the `'0.00'` seed default acknowledged as a requirement — i.e. is "ships free-by-default until an admin sets a price" an intended, documented launch state, and is [NEEDS CLARIFICATION 1] (default assessment price) flagged as still-open? [Ambiguity, Spec §NEEDS CLARIFICATION 1 / data-model.md §2]
- [ ] CHK024 Does the spec require that a free-by-default price cannot be exploited to farm specialist sessions — i.e. is the assessment frequency limit binding even while the price is `0.00`? [Scenario/Edge Coverage, Spec §FR-014 / Edge Cases]
- [ ] CHK025 Is the admin price-write authorization requirement (service-role/`is_admin()` only; non-admin rejected) stated with the expected rejection outcome, and the value format constrained (non-negative decimal)? [Acceptance Criteria, Spec §FR-002 / contracts/api.md §5]
- [ ] CHK026 Is the assessment frequency limit fully resolved — does the spec reflect [NEEDS CLARIFICATION 2] as RESOLVED to per-specialty via `hifz_assessment_limit_per_specialty`, with no residual ambiguity about lifetime vs per-specialty vs per-N-days? [Ambiguity, Spec §Clarifications / FR-014]

## Specialized-Purpose Enum & Quran Validation

- [ ] CHK027 Does the spec reflect [NEEDS CLARIFICATION 3] as RESOLVED — that `specialized_purpose` is a NEW enum (not reused `session_type`/`specialties`), and is the enum's member set stated identically across spec, data-model, and contracts? [Consistency, Spec §Clarifications / data-model.md §2 / contracts/api.md §1]
- [ ] CHK028 Is the Quran-target validation requirement stated as fail-closed-before-charge — invalid surah/ayah/juz range rejected (422) BEFORE any Stripe session creation or DB write, never "corrected"? [Scenario/Edge Coverage, Spec §FR-015 / Edge Cases]
- [ ] CHK029 Is the canonical validation source named unambiguously (`src/lib/quran/ayah-counts.ts` + `student_progress_ayah_range_guard` lineage) so the requirement cannot be satisfied by a model-generated range? [Clarity, Spec §FR-015]

## Read Path & Contract Completeness

- [ ] CHK030 Is the `GET /api/single-sessions/my-bookings` read requirement complete — it appears in contracts/api.md §4 but has NO corresponding task in tasks.md; is the read product a real requirement or an orphaned contract? [Conflict, contracts/api.md §4 vs tasks.md]
- [ ] CHK031 Does the my-bookings read requirement state its authorization boundary (student reads ONLY own rows via RLS) and its pagination envelope, so it cannot leak other students' bookings/payments? [Completeness, contracts/api.md §4 / Spec §FR-017]
- [ ] CHK032 Is the `payments.booking_id UNIQUE nullable` one-to-one linkage stated as a requirement that prevents two payments claiming one booking AND leaves subscription-funded payments (NULL) unaffected? [Consistency, Spec §FR-011 / data-model.md §1]

## Identity, RLS & SECURITY DEFINER Lockdown

- [ ] CHK033 Is "student identity comes from the authenticated session, never request input" stated for all three products AND for the webhook path (where `student_id` originates from PI metadata set server-side at checkout)? [Completeness, Spec §FR-005 / contracts/api.md §3]
- [ ] CHK034 Is the EXECUTE-lockdown requirement (revoke from public/anon/authenticated; grant service_role only) stated to bind BOTH any new atomic creator AND the adapted `start_instant_session_booking`, with atomicity preserved? [Completeness, Spec §NFR-002/FR-009]
- [ ] CHK035 Is the requirement that financial/identity columns are immutable-after-creation specified by column (product type, price/payment linkage, assigned teacher, specialty, purpose, target_scope) rather than as a general "guard the row" statement? [Clarity, Spec §FR-018 / data-model.md §2]

## Dependencies & Assumptions

- [ ] CHK036 Is the assumption that this spec OWNS payment-mode Checkout + `payment_intent.succeeded` (not reused from spec 018) stated unambiguously, with spec 018's reused surface (signature verification, `billing_events` idempotency) scoped precisely? [Dependencies & Assumptions, Spec §Assumptions]
- [ ] CHK037 Is the USD-only constraint stated as a requirement with a defined rejection behavior for non-USD, rather than only an inherited assumption? [Completeness, Spec §Edge Cases / Assumptions]
- [ ] CHK038 Is the dependency on spec 020 for specialist availability/matching bounded so that "no available specialist" has a defined, fail-loud requirement here even if 020's mechanics change? [Dependencies & Assumptions, Spec §FR-012/FR-013]

## Notes

- CHK008, CHK014, CHK017, CHK030 are flagged **conflicts** between resolved clarifications/spec intent and the as-written data-model/contracts/tasks — fix the artifacts before implementation.
- CHK020 is a **gap**: FR-013 references refund/reconcile but no owning requirement defines it.
- CHK023/CHK026/CHK027 track the three NEEDS-CLARIFICATION items; 2 & 3 should read as RESOLVED, 1 remains open.
- Check items off as `[x]` and record findings inline.
