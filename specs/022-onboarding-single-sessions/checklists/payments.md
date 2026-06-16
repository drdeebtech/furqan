# Single-Session Payments Security Requirements Checklist

**Purpose**: Quality-gate the *requirements* for spec 022's one-time-paid single-session products through a payments-security / fail-closed lens — auditing whether the spec, plan, data-model, and contracts express their money-handling, fail-closed, and no-debit obligations clearly, completely, consistently, and measurably. This is a "unit test for the requirements," not a verification of code.
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md) · [contracts/api.md](../contracts/api.md)

**Note**: Each item is a question about requirement quality. Answer YES (requirement is sound) or NO (gap/defect to fix in the spec). Items are risk-prioritized: fail-closed, no-debit, and the service-role guard idiom lead.

## Fail-Closed & No-Debit Invariants (highest risk)

- [x] CHK001 RESOLVED (2026-06-16): the fail-closed invariant now names every binding path, and the zero-price path is no longer a separate "direct-create" — it calls the SAME atomic `create_single_session_booking` creator with `p_payment_id := NULL` (contracts §1 step 5 / §3 "Single creation path" / data-model §3 / tasks T012). Paths: zero-price route→creator, instant→`start_instant_session_booking`, assessment/specialized webhook→creator. No bare INSERT anywhere. [Completeness, Spec §NFR-001/FR-008]
- [ ] CHK002 Is the fail-closed requirement measurable — does it define the observable success condition (0 sessions created for an unconfirmed/abandoned/failed payment) rather than a behavioral assertion? [Acceptance Criteria, Spec §SC-004]
- [x] CHK003 RESOLVED (2026-06-16): data-model §3 now states zero-price is the *intended exception* to NFR-001 (not a violation), proceeds through the SAME atomic creator (`p_payment_id := NULL`), and is gated by the fail-before-charge specialist-match + limit checks (R-004). FR-003 ("yet still proceed through the same booking path") is now honored by contracts/tasks. [Clarity, Spec §FR-003/NFR-001]
- [ ] CHK004 Is the no-debit invariant ("MUST NOT debit `student_packages` / consume subscription credit") stated as a requirement that binds all three products on all paths, including the adapted `start_instant_session_booking`? [Completeness, Spec §FR-007/NFR-001]
- [ ] CHK005 Is the no-debit invariant given a measurable acceptance criterion (e.g. "zero `student_packages` debits" / "credit balance unchanged in 100%") rather than only prose? [Acceptance Criteria, Spec §SC-001/SC-002]
- [ ] CHK006 Is the requirement that a subscriber with available credits is *still* charged the one-time price (never silently credit-funded) explicitly stated as a non-negotiable, not merely an edge case? [Completeness, Spec §FR-007 / Edge Cases]

## Service-Role Guard Idiom (consistency — known defect)

- [ ] CHK007 Does the spec require the single-session identity guard's service-role detection to use the VERIFIED canonical idiom `nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='service_role'`, treating a NULL/empty JWT as a trusted direct-DB/migration write? [Consistency, Spec §Clarifications 2026-06-16]
- [x] CHK008 RESOLVED (2026-06-16): data-model.md §2 now uses the canonical `nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='service_role'` idiom (NULL/empty JWT = trusted direct-DB/migration write). The forbidden `current_setting('role')` form is gone from all spec-022 artifacts. Verify it stays consistent across data-model, tasks (T004), and plan. [Conflict resolved, data-model.md §2 vs Spec §Clarifications]
- [ ] CHK009 Is the requirement explicit that, with the wrong GUC, the service-role exemption would *never match* — so every service-role/migration write would be blocked by its own guard (fail-closed-to-broken)? [Clarity, Spec §Clarifications]
- [ ] CHK010 Is "match the idiom used by existing guard migrations" stated as a binding consistency requirement (not just a note), so the guard does not diverge from the platform-wide convention? [Consistency, Spec §FR-018]
- [ ] CHK011 Does the requirement specify the admin-exemption mechanism (`private.is_admin()`) and migration-exemption precisely enough that the guard cannot be silently bypassed via a mutable column the guard does not read? [Completeness, Spec §FR-018]

## booking_product_type / Legacy NULL Invariant

- [ ] CHK012 Is the "NULL `booking_product_type` = legacy credit-funded" invariant stated as a requirement that reporting AND RLS must honor (not only a prose aside in Clarifications)? [Completeness, Spec §Clarifications]
- [ ] CHK013 Is it specified that the column is added by this spec and absent today, so existing rows become NULL — and is the back-fill/interpretation rule for those NULL rows unambiguous? [Clarity, Spec §Clarifications / data-model.md §2]
- [ ] CHK014 Does the `CHECK (booking_product_type IN ('assessment','instant','specialized','subscription'))` constraint reconcile with "legacy rows are NULL" — i.e. is NULL explicitly permitted by the constraint and reporting? [Consistency, data-model.md §2 vs Spec §Clarifications]
- [ ] CHK015 Is there a requirement that single-session RLS / reconciliation queries distinguish one-time-paid rows from NULL-legacy rows so a legacy row is never mis-counted as one-time-paid (or vice versa)? [Completeness, Spec §SC-001]

## Atomic Booking+Session Creation & Recovery (exception coverage)

- [x] CHK016 RESOLVED (2026-06-16): the atomic SECURITY DEFINER creator `create_single_session_booking` (booking + session in one transaction) is now specified in data-model.md §3 and tasks T007b; webhook bare INSERT is explicitly forbidden. [Completeness, Spec §Clarifications]
- [x] CHK017 RESOLVED (2026-06-16): conflict closed — contracts/api.md §3 and tasks T013/T019 now CALL `create_single_session_booking` instead of webhook-side `INSERT into bookings + sessions`. [Conflict resolved, contracts/api.md §3 / tasks.md T013,T019 vs Spec §Clarifications]
- [x] CHK018 RESOLVED (2026-06-16): "payment confirmed but session creation fails" recovery is now defined (data-model.md §3 + contracts/api.md §3 Recovery): atomic creator prevents partial state; `billing_events` lock makes retry idempotent; an unmaterializable charge stays in `payments` with `booking_id` NULL for reconciliation/refund. [Scenario/Edge Coverage, Spec §Edge Cases]
- [ ] CHK019 Is the charge-but-no-specialist outcome (FR-013) specified with a decision rule on ordering — fail-before-charge (no charge taken) vs charge-then-refund/reconcile — rather than offering both as undifferentiated alternatives? [Ambiguity, Spec §FR-013 / Edge Cases] — NOTE: research R-004 fixes ordering as fail-before-charge (match specialist → then Stripe); the residual reconcile path is now the NULL-`booking_id` recovery above.
- [ ] CHK020 Is a refund/reconciliation requirement actually defined anywhere (who initiates it, against what ledger, in what time bound), or is FR-013's "reconcilable/refundable per 018" an unbacked reference with no owning requirement? [Gap, Spec §FR-013]
- [ ] CHK021 Is idempotency specified as a measurable requirement — "at most one session and one payment per intent" keyed on a named idempotency key (`pi_{id}` in `billing_events`) — for ALL three products, not just instant? [Acceptance Criteria, Spec §FR-010/SC-005]

## Pricing / Configuration Requirements (measurability)

- [ ] CHK022 Is "prices are configuration data, never hardcoded" stated as a verifiable requirement (e.g. read at booking time from `platform_settings`, with a definable check) rather than an aspiration? [Clarity, Spec §FR-002]
- [ ] CHK023 Is the risk of the `'0.00'` seed default acknowledged as a requirement — i.e. is "ships free-by-default until an admin sets a price" an intended, documented launch state, and is [NEEDS CLARIFICATION 1] (default assessment price) flagged as still-open? [Ambiguity, Spec §NEEDS CLARIFICATION 1 / data-model.md §2]
- [x] CHK024 RESOLVED (2026-06-16): the per-specialty assessment limit (`hifz_assessment_limit_per_specialty`, FR-014) is now bound at the route BEFORE pricing/Stripe (tasks T012), so it applies even at `0.00`; over-limit → **409** (contracts §1). Limit is independent of price. [Scenario/Edge Coverage, Spec §FR-014 / Edge Cases]
- [ ] CHK025 Is the admin price-write authorization requirement (service-role/`is_admin()` only; non-admin rejected) stated with the expected rejection outcome, and the value format constrained (non-negative decimal)? [Acceptance Criteria, Spec §FR-002 / contracts/api.md §5]
- [x] CHK026 RESOLVED (2026-06-16): [NEEDS CLARIFICATION 2] resolved to per-specialty limit via `hifz_assessment_limit_per_specialty` (platform_settings); bound at the route before Stripe (T012); 409 on over-limit. Spec §Clarifications + FR-014. No residual lifetime-vs-per-specialty ambiguity. [Ambiguity, Spec §Clarifications / FR-014]

## Specialized-Purpose Enum & Quran Validation

- [x] CHK027 RESOLVED (2026-06-16): [NEEDS CLARIFICATION 3] resolved — `specialized_purpose` is a NEW enum (`review | consolidate_surah | memorize_mutoon | test_juz_mutashabihat`), not reused from `session_type`/`specialties`; member set is identical across spec Clarifications, data-model.md §2, and contracts/api.md §1. [Consistency, Spec §Clarifications / data-model.md §2 / contracts/api.md §1]
- [ ] CHK028 Is the Quran-target validation requirement stated as fail-closed-before-charge — invalid surah/ayah/juz range rejected (422) BEFORE any Stripe session creation or DB write, never "corrected"? [Scenario/Edge Coverage, Spec §FR-015 / Edge Cases]
- [ ] CHK029 Is the canonical validation source named unambiguously (`src/lib/quran/ayah-counts.ts` + `student_progress_ayah_range_guard` lineage) so the requirement cannot be satisfied by a model-generated range? [Clarity, Spec §FR-015]

## Read Path & Contract Completeness

- [x] CHK030 RESOLVED: `GET /api/single-sessions/my-bookings` now has a corresponding task — **T020a** (auth-required, RLS-enforced, paginated). Contract §4 is no longer orphaned. `scheduledAt` typed `string | null` (unscheduled bookings, data-model §3). [Conflict resolved, contracts/api.md §4 vs tasks.md]
- [ ] CHK031 Does the my-bookings read requirement state its authorization boundary (student reads ONLY own rows via RLS) and its pagination envelope, so it cannot leak other students' bookings/payments? [Completeness, contracts/api.md §4 / Spec §FR-017]
- [ ] CHK032 Is the `payments.booking_id UNIQUE nullable` one-to-one linkage stated as a requirement that prevents two payments claiming one booking AND leaves subscription-funded payments (NULL) unaffected? [Consistency, Spec §FR-011 / data-model.md §1]

## Identity, RLS & SECURITY DEFINER Lockdown

- [ ] CHK033 Is "student identity comes from the authenticated session, never request input" stated for all three products AND for the webhook path (where `student_id` originates from PI metadata set server-side at checkout)? [Completeness, Spec §FR-005 / contracts/api.md §3]
- [x] CHK034 RESOLVED (2026-06-16): EXECUTE lockdown (REVOKE public/anon/authenticated; GRANT service_role only) is now stated for BOTH the new atomic `create_single_session_booking` (data-model.md §3) AND the adapted `start_instant_session_booking`, atomicity preserved. [Completeness, Spec §NFR-002/FR-009]
- [ ] CHK035 Is the requirement that financial/identity columns are immutable-after-creation specified by column (product type, price/payment linkage, assigned teacher, specialty, purpose, target_scope) rather than as a general "guard the row" statement? [Clarity, Spec §FR-018 / data-model.md §2]

## Dependencies & Assumptions

- [ ] CHK036 Is the assumption that this spec OWNS payment-mode Checkout + `payment_intent.succeeded` (not reused from spec 018) stated unambiguously, with spec 018's reused surface (signature verification, `billing_events` idempotency) scoped precisely? [Dependencies & Assumptions, Spec §Assumptions]
- [x] CHK037 RESOLVED (2026-06-16): non-USD now has a defined rejection behavior — **422** at the checkout route, before any Stripe call (contracts §1 Error Codes + rationale; tasks T012). No longer only an inherited assumption. [Completeness, Spec §Edge Cases / Assumptions]
- [ ] CHK038 Is the dependency on spec 020 for specialist availability/matching bounded so that "no available specialist" has a defined, fail-loud requirement here even if 020's mechanics change? [Dependencies & Assumptions, Spec §FR-012/FR-013]

## Notes

- CHK008, CHK017 conflicts are now RESOLVED in the artifacts (2026-06-16 propagation): guard idiom corrected and webhook now calls the atomic `create_single_session_booking`. CHK030 is now RESOLVED (T020a added; zero-price path routed through the same atomic creator). CHK014 remains the one open conflict to fix before implementation (NULL `booking_product_type` vs the CHECK constraint / reporting reconciliation).
- CHK020 (**gap**): FR-013 references refund/reconcile; a concrete recovery is now defined (NULL-`booking_id` rows left for reconciliation — data-model.md §3 / contracts §3), but the *owning* requirement (who initiates, ledger, time bound) is still not formalized in spec.md — keep open.
- CHK023/CHK026/CHK027 track the three NEEDS-CLARIFICATION items; 2 & 3 should read as RESOLVED, 1 remains open.
- Check items off as `[x]` and record findings inline.
