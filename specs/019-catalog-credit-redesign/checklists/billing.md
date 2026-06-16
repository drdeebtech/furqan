# Billing & Money-Path Requirements Checklist: Catalog + Credit Redesign

**Purpose**: Unit-test the *requirements* (not the implementation) for the billing/money-path surface of spec 019 — completeness, clarity, consistency, measurability, and coverage of catalog pricing, credit grants, proration, family discounts, and tier changes.
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [data-model.md](../data-model.md) · [contracts/api.md](../contracts/api.md)

**Note**: Each item is a QUESTION about whether the requirement is well-written. Items never assert implementation behavior. Check `[x]` when the requirement passes the quality bar; annotate gaps inline.

## Requirement Completeness

- [ ] CHK001 Verify the requirement defining WHO applies a pending tier change and re-grants at renewal is traceable to a functional requirement and a planned task — resolved: the `invoice.paid` webhook branch owns it (Spec §Clarifications, plan §Key Decision 6, task T014a). [Consistency, Spec §FR-019]
- [ ] CHK002 Does FR-019 specify the lifecycle of a `pending_tier_changes` record (pending → applied/cancelled) as a requirement, including who performs each transition? [Completeness, Spec §FR-019]
- [ ] CHK003 Is the single-active-hifz invariant specified as a *data-layer* requirement with a named enforcement mechanism, not merely a UI expectation? [Completeness, Spec §FR-009]
- [ ] CHK004 Verify the single-pending-tier-change-per-subscription invariant is enforced at the data layer — resolved: partial UNIQUE index on `pending_tier_changes(subscription_id) WHERE status='pending'` (data-model §2c, tasks T003). [Consistency, Spec §Clarifications]
- [ ] CHK005 Are the exact second-individual and sibling-group discount percentages specified, or explicitly designated as admin-entered settings with a defined default? [Ambiguity, Spec §FR-014]
- [ ] CHK006 Is there a requirement covering whether a discounted second/sibling subscription re-rates at renewal when the qualifying first subscription has lapsed? [Gap, Spec §Edge Cases / Open clarifications]
- [ ] CHK007 Is the discount-immutability rule (a recorded discount cannot be silently altered after application) stated as a requirement, including who may never mutate it? [Completeness, Spec §FR-015/FR-016]
- [ ] CHK008 Is per-cycle grant idempotency (at most one grant per billing cycle) stated as a requirement with an identified idempotency key? [Completeness, Spec §FR-010]
- [ ] CHK009 Is the source of truth for every adjustable money value (prices, per-hour rate, discounts, assessment price) enumerated so none is left implicitly hardcoded? [Completeness, Spec §NFR-001]
- [ ] CHK010 Is the assessment-session price requirement complete — referenced as an admin setting with a defined default and ownership boundary (spec 022)? [Completeness, Spec §Edge Cases]
- [ ] CHK011 Are RLS write-authority requirements for each new money-bearing table (catalog tier, discount record, grant) specified in the same migration as the table? [Completeness, Spec §NFR-002]

## Requirement Clarity

- [ ] CHK012 Is the Stripe `proration_behavior` value stated as a single, unambiguous, VALID enum (`always_invoice`) everywhere it appears? [Clarity, Spec §Clarifications]
- [ ] CHK013 Verify no artifact still uses an invalid or divergent proration enum value — resolved: every `proration_behavior` occurrence in plan.md, research.md, contracts §2, and tasks T022 now reads `always_invoice` (Spec §Clarifications). [Consistency, plan.md §Key Decisions / contracts §2]
- [ ] CHK014 Is "additively merged" (FR-011) defined precisely enough to be unambiguous — i.e. does it state that a new `student_packages` row is added and prior rows are never mutated? [Clarity, Spec §FR-011]
- [ ] CHK015 Is "same teacher" defined clearly enough to evaluate an upgrade, given the teacher field is owned by spec 020 and may be absent this phase? [Ambiguity, Spec §FR-017 / contracts §2 step 5]
- [ ] CHK016 Is "tier terms captured at grant time" (FR-012) clear about exactly which fields are frozen (sessions, duration, price basis) so a later catalog edit cannot retroactively change a granted cycle? [Clarity, Spec §FR-012]
- [ ] CHK017 Is the `add-child` input contract stated unambiguously as a single canonical shape (`{childEmail}`, server-resolved to `child_id`)? [Conflict, Spec §Clarifications vs contracts §5]
- [ ] CHK018 Is the new-member `package_type` count stated as a single value (ONE new member `tajweed_course`) rather than the divergent "7 new values"? [Conflict, Spec §Clarifications vs data-model §1c]
- [ ] CHK019 Is "prorated charge computed from the price difference" (FR-018) specified clearly enough (which prices, which remaining-cycle basis) to be implementable without guessing? [Clarity, Spec §FR-018]
- [ ] CHK020 Is the meaning of "active" for catalog exposure (FR-005) and for the single-active-hifz status set unambiguous and consistent across spec and data-model? [Clarity, Spec §FR-005 / data-model §1b]

## Requirement Consistency

- [ ] CHK021 Is the proration behavior specified once and identically across spec Clarifications, plan.md, and contracts/api.md (no conflicting enum values)? [Conflict, plan §4 / contracts §2 / Spec §Clarifications]
- [ ] CHK022 Verify the `add-child` request field is consistent across spec, contracts/api.md, and the Clarifications resolution — resolved: contracts §5 now takes `{ childEmail }` (server resolves to `child_id`); no raw-uuid form remains. [Consistency, contracts §5 / Spec §Clarifications]
- [ ] CHK023 Is the count and identity of new `package_type` members consistent between data-model.md (lists 7 added values incl. 6 hifz + tajweed) and the Clarifications note ("ONE new value tajweed_course, total 12")? [Conflict, data-model §1c / Spec §Clarifications]
- [ ] CHK024 Are the price-tier values consistent between FR-003 (group 4/6/8 = $12/$15/$20; individual $10/hr) and the seeded `platform_settings` keys in data-model §3? [Consistency, Spec §FR-003 / data-model §3]
- [ ] CHK025 Is the discount default consistent — spec leaves percentages `[NEEDS CLARIFICATION]` while data-model seeds `10`; is the seed a placeholder or a committed value? [Conflict, Spec §Open clarifications / data-model §3]
- [ ] CHK026 Do the catalog-model requirements agree on where a hifz tier lives — `subscription_plans` (plan §2) vs `packages` rows (data-model §1c) — without contradicting FR-004's plan-mirror requirement? [Consistency, plan §2 / data-model §1c / Spec §FR-004]
- [ ] CHK027 Is the additive-merge rule stated consistently across FR-011, FR-020, and the mid-cycle upgrade requirement (FR-017) so no path implies overwrite? [Consistency, Spec §FR-011/FR-017/FR-020]
- [ ] CHK028 Are the no-retroactive-change requirements (FR-012, FR-016, SC-006) mutually consistent on the boundary "binds only at next renewal"? [Consistency, Spec §FR-012/FR-016/SC-006]

## Acceptance Criteria Quality

- [ ] CHK029 Is FR-011's "never silently lost, reset, or overstated" expressed as a measurable criterion (e.g. reconciliation query across multiple cycles preserving `sessions_used`)? [Measurability, Spec §FR-011 / SC-003]
- [ ] CHK030 Is "no hardcoded prices" stated as an objectively verifiable criterion (a code scan for price literals returns zero), per SC-001? [Measurability, Spec §SC-001 / NFR-001]
- [ ] CHK031 Is the single-active-hifz success criterion measurable under concurrency (0 double-hifz states across 100% of attempts incl. concurrent), per SC-002? [Measurability, Spec §SC-002]
- [ ] CHK032 Is the proration correctness criterion measurable — is there a defined expected proration amount to compare against, or only "prorates correctly"? [Measurability, Spec §SC-005 / FR-018]
- [ ] CHK033 Is the discount-application criterion measurable and auditable (applied discount + percentage recorded and reconcilable) per FR-015/SC-004? [Measurability, Spec §FR-015 / SC-004]
- [ ] CHK034 Does each P1 user story have an Independent Test whose pass/fail on a money value is objectively decidable from data, not interpretation? [Acceptance, Spec §User Stories 1–3]

## Scenario / Edge Coverage

- [ ] CHK035 Is the mid-cycle downgrade path covered by a requirement (deferred to renewal, queued as pending) rather than only an Edge Case note? [Coverage, Spec §FR-019 / Edge Cases]
- [ ] CHK036 Is the concurrent double-hifz race covered by a requirement that enforcement holds at the data layer, not just the happy path? [Coverage, Spec §FR-009 / Edge Cases]
- [ ] CHK037 Is the "tier edited after a student subscribed" scenario covered by a requirement preventing retroactive grant changes? [Coverage, Spec §FR-012 / Edge Cases]
- [ ] CHK038 Is the discount-overlap scenario (sibling + second-subscription on one guardian) covered by a requirement stating they do not stack on a single subscription absent an admin setting? [Coverage, Spec §FR-014 / Edge Cases]
- [ ] CHK039 Is a non-60-minute session-duration tier covered by a requirement that each grant carries its own duration unambiguously? [Coverage, Spec §FR-010 / Edge Cases]
- [ ] CHK040 Is the upgrade idempotency-on-retry scenario (endpoint called before webhook fires) covered by a requirement, not only an implementation note? [Coverage, Spec §FR-010 / contracts §2 Idempotency]

## Non-Functional (Money-Path Security)

- [ ] CHK041 Is there a requirement that financial/identity columns (price, sessions, tier reference, discount_pct, guardian linkage) are guarded against client mutation, with service-role/admin/migration exemptions defined? [Non-Functional, Spec §NFR-003]
- [ ] CHK042 Is there a requirement that grant writes and discount-record writes are service-role-only, while price/discount writes are admin-only? [Non-Functional, Spec §NFR-002]
- [ ] CHK043 Is local Postgres verification of grant, additive merge over multiple cycles, single-active-hifz race, and prorated increase stated as a release gate requirement? [Non-Functional, Spec §NFR-004]
- [ ] CHK044 Is `sb:advisors` cleanliness for the new money-bearing tables stated as a measurable gate? [Non-Functional, Spec §NFR-004]

## Dependencies & Assumptions

- [ ] CHK045 Is the dependency on spec 018's grant-on-payment rails stated as a hard precondition for any credit-grant requirement (cannot grant without 018)? [Assumption, Spec §Dependencies]
- [ ] CHK046 Is the assumption "discounts apply to their own product family and do not stack" recorded as a constraint the discount requirements depend on? [Assumption, Spec §Assumptions]
- [ ] CHK047 Is the assumption that the per-hour individual rate ($10) and 60-minute default duration are settings (not fixed constants) explicitly tied to NFR-001's no-hardcoding rule? [Assumption, Spec §Assumptions / NFR-001]

## Ambiguities & Conflicts (consolidated)

- [ ] CHK048 Are all three Clarifications-resolved items (proration enum, add-child input, package_type count) reflected back into the body of spec/contracts/data-model, or do stale conflicting statements remain? [Conflict, Spec §Clarifications]
- [ ] CHK049 Verify FR-019's renewal-application owner is backed by a planned task closing the "write-only, no owner" gap — resolved: task T014a wires the `invoice.paid` branch to apply pending changes and re-grant (plan §Key Decision 6). [Consistency, Spec §FR-019 / Clarifications]
- [ ] CHK050 Is the discount-percentage `[NEEDS CLARIFICATION]` either resolved to committed values or unambiguously deferred to admin settings with a stated default, so no implementer hardcodes a guess? [Ambiguity, Spec §Open clarifications]

## Notes

- Check items off as the underlying requirement is fixed/confirmed: `[x]`.
- Conflict items (CHK013, CHK017/22, CHK018/23, CHK021, CHK025, CHK048) trace to the known Clarifications-session findings and should be closed before tasks regen.
- This checklist validates requirement quality only; behavioral/implementation testing is covered by NFR-004/NFR-005 and the test plan.
