# Feature Specification: Website Trust & Credibility Remediation

**Feature Branch**: `035-website-trust-credibility`
**Created**: 2026-06-30
**Status**: Draft
**Input**: User description: "Remediate the trust and credibility gaps found in the 2026-06-30 seven-persona review of the live furqan.today public site."

## Background *(context)*

On 2026-06-30 the live public site was reviewed by seven independent reviewer personas (a non-technical parent, a software engineer, a small-business owner, a large-institution buyer, a senior full-stack developer, a senior Quran teacher, and a senior teaching-platform consultant). Average score: **~5.3 / 10**. The Quran content itself passed cleanly — every displayed ayah was correct and fully voweled — so this feature does **not** touch Quran text. Every gap below is in the **trust layer**: what a prospective family or partner sees before they pay.

All seven reviewers independently named the same dominant defect (placeholder/test teacher accounts visible in production), which is why it is the single P1 below and is authored to ship on its own, ahead of the rest.

## Clarifications

### Session 2026-06-30

- Q: How should the platform structurally identify which teachers may appear publicly, so test/seed accounts can never leak again? → A: Default-deny allow-list — show a teacher only when an explicit published/active status is set, AND exclude known test-fixture email domains as a second layer. A new seed/E2E row is invisible by default with no manual cleanup.
- Q: What is the minimum bar for a real teacher to appear on the public teachers page (the P1 gate)? → A: Hard gate = published/active AND not a test account. Missing presentation details (photo, availability, price) are shown with dignified placeholders rather than hiding the teacher, to avoid worsening cold-start; a credential is strongly encouraged but not hard-blocking.
- Q: Are teacher ratings/reviews in scope for spec 035, or display-ready only? → A: Deferred — display-ready only. 035 ships profile credibility (photo, bio, verifiable credential, languages, availability, price); review capture is a later feature; ratings render only if such data already exists (never invented).
- Q: How should a real, credentialed teacher with zero completed sessions be shown? → A: Show with a positive "New" treatment and no bare zero-session counter.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No fake or unfinished teachers appear publicly (Priority: P1)

A visiting parent opens the public teachers page and sees only real, presentable teachers. Test/placeholder accounts ("Test Teacher", "E2E Test Teacher (DELETE ME)") and unfinished profiles never appear. This is the page that decides whether a family trusts the platform with their child, so it is the highest priority and ships first, by itself.

**Why this priority**: All seven personas flagged this as the #1 trust-killer; it is live in production today, it is the cheapest fix, and it blocks the value of every other improvement. Until it is fixed, polishing anything else is wasted.

**Independent Test**: Load the public teachers page (and any teacher shown on the home page) as an anonymous visitor and confirm no test/placeholder/unpublished profile is listed; confirm a known test account is absent. Delivers immediate, standalone trust value.

**Acceptance Scenarios**:

1. **Given** test/seed teacher accounts exist in the data, **When** an anonymous visitor loads the public teachers page, **Then** none of those accounts are shown.
2. **Given** a teacher profile that is not published/active or is missing required presentation details, **When** the public teachers list renders, **Then** that profile is excluded.
3. **Given** a new test or seed account is created later, **When** the public list renders, **Then** it is still excluded without any further manual cleanup (the rule is structural, not a one-time deletion).
4. **Given** the teachers page is filtered, **When** a search engine or a non-Arabic visitor views it, **Then** the same exclusions apply on every public surface that lists or links a teacher — the teachers list, any featured-teacher area, and the contact-prefill link (`/contact?teacher=…`). (There is currently **no standalone public teacher-detail page**; teachers link to the contact prefill. If one is added later it inherits this same rule.)

---

### User Story 2 - Teacher profiles are verifiable enough to choose from (Priority: P2)

A parent comparing teachers can actually decide between them: each public teacher shows a photo (or dignified placeholder), a real biography, the teacher's verifiable ijazah/sanad and riwayah, languages spoken, general availability, and the price tier — turning the page from a flat directory into a chooser.

**Why this priority**: Reviewers said the teachers page is "a directory, not a chooser." Even with test accounts removed, thin profiles (initials only, no bio, no credentials) leave a buyer unable to commit. This is the conversion engine of any tutoring marketplace.

**Independent Test**: Open three real teacher profiles as a visitor and confirm each shows photo/placeholder, bio, stated and verifiable ijazah/riwayah, languages, availability indication, and price tier — enough to pick one without registering first.

**Acceptance Scenarios**:

1. **Given** a published teacher, **When** a visitor views the profile, **Then** photo/placeholder, biography, ijazah/riwayah, languages, availability, and price tier are all present.
2. **Given** a teacher with a verifiable credential, **When** the profile renders, **Then** the credential is presented as a specific, checkable claim (named riwayah/sanad), not a generic "certified" tag alone.
3. **Given** a real teacher who has completed zero sessions, **When** the profile renders, **Then** the platform presents them honestly (e.g. a "New" treatment) rather than displaying a bare "0 sessions" counter that reads as broken.

---

### User Story 3 - Testimonials are authentic and varied (Priority: P2)

A visitor reading social proof sees multiple distinct, attributable testimonials whose details are internally consistent, instead of one quote repeated across pages with conflicting attribution.

**Why this priority**: Reviewers read the current single, repeated, inconsistently-attributed quote (hero says Kuwait, body says London/Manchester/Dubai; one garbled name) as fabricated — "worse than none." Believable proof directly affects whether a family pays.

**Independent Test**: Visit the home, pricing, teachers, and about pages and confirm testimonials are multiple, distinct, consistently attributed, and (where claimed) tied to a real student/teacher relationship.

**Acceptance Scenarios**:

1. **Given** the public pages, **When** a visitor reads testimonials, **Then** at least several distinct testimonials are shown with consistent name/location attribution.
2. **Given** a testimonial references a teacher, **When** it is displayed, **Then** the referenced teacher corresponds to a real, published teacher.
3. **Given** a testimonial cannot be substantiated, **When** the page renders, **Then** it is not presented as a specific named/located customer quote.

---

### User Story 4 - The site never advertises an empty room (Priority: P3)

A visitor who follows a promoted feature (e.g. "recorded courses") finds real content, not a "nothing here yet" page. Features that are not ready are not headlined in navigation, hero, or footer.

**Why this priority**: The courses surface currently renders "no courses published yet" while the nav/hero/footer promote it — reviewers read this as half-built. It erodes trust cheaply and is simple to gate.

**Independent Test**: Click every promoted feature link in nav/hero/footer as a visitor and confirm each leads to real content or is not promoted while empty.

**Acceptance Scenarios**:

1. **Given** a content area has no published items, **When** the site renders, **Then** that area is not promoted in primary navigation, hero, or footer.
2. **Given** a previously-empty area receives published content, **When** the site renders, **Then** the promotion reappears automatically.

---

### User Story 5 - Non-Arabic visitors are not lost on arrival (Priority: P3)

A non-Arabic-reading diaspora parent landing on the site is presented in a language they can read, or with an unmistakable way to switch, rather than hitting an Arabic-only first screen and bouncing.

**Why this priority**: The paying audience includes diaspora families in the UK/US/Canada who do not read Arabic. Reviewers said an Arabic-first landing with a hard-to-find toggle reads as "wrong place." This widens the top of the funnel.

**Independent Test**: Visit the site with a non-Arabic browser language preference and confirm the experience is either presented in English or offers an immediately obvious, persistent language switch; confirm the choice is remembered on return.

**Acceptance Scenarios**:

1. **Given** a visitor whose browser prefers a non-Arabic language, **When** they land on the site, **Then** they are shown an English experience or a prominent, immediately visible language switch.
2. **Given** a visitor chooses a language, **When** they navigate or return later, **Then** their choice is preserved.
3. **Given** any visitor, **When** they look for the language control, **Then** it is discoverable without scrolling or hunting.

---

### User Story 6 - Institutions can see a credible organization and a way in (Priority: P4)

A representative of a large Islamic-education organization evaluating a partnership can find evidence of a real organization (named leadership, a legal entity, a child-safeguarding stance, a privacy posture) and a clear institutional/partnership contact path — not only a personal email and one messaging number.

**Why this priority**: The two institutional personas scored lowest (4/10) and said the platform is "unpartnerable" today for lack of governance and a B2B path. This unlocks a higher-value channel but does not block consumer conversion, so it is lowest priority here.

**Independent Test**: As an institutional visitor, attempt to verify the organization and start a partnership conversation; confirm leadership/entity/safeguarding/privacy information and an institutional contact route exist.

**Acceptance Scenarios**:

1. **Given** an institutional visitor, **When** they review the site, **Then** named leadership, an organizational/legal identity, a child-safeguarding statement, and a privacy posture are discoverable.
2. **Given** an institutional visitor, **When** they want to engage, **Then** a clear partnerships/contact path exists beyond a personal email and a single messaging number.

---

### Edge Cases

- A teacher is published but later deactivated or fails verification → must disappear from public surfaces immediately, consistently across home, list, and direct profile link.
- A real, credentialed teacher has zero completed sessions → shown honestly (e.g. "New") rather than hidden, to avoid emptying the marketplace, but never shown as a bare broken-looking counter.
- A direct link to an excluded teacher's profile is shared → the profile is not publicly viewable while excluded.
- A visitor with an Arabic browser preference still wants English (or vice-versa) → manual override always wins and persists.
- A testimonial's referenced teacher is later unpublished → the testimonial must not surface a now-invisible teacher.
- A promoted content area is emptied (all items unpublished) → its promotion is withdrawn automatically.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The public teachers experience MUST operate as a default-deny allow-list: a teacher is shown ONLY when an explicit published/active status is set. Any account without that status (including any seed/test/fixture row created now or later) is excluded automatically, with no manual cleanup. As a second defense-in-depth layer, known test-fixture email domains MUST also be excluded.
- **FR-002**: The hard gate for public listing MUST be: published/active status set AND not a test-fixture account. Missing presentation details (photo, availability, price) MUST NOT remove a teacher from the list; they are shown with dignified placeholders instead (so real, growing supply is not hidden). A verifiable credential is strongly encouraged but is not a hard listing blocker.
- **FR-003**: Exclusion rules (FR-001/FR-002) MUST apply uniformly on every public surface that lists or links a teacher (home, teachers list, individual profile, and any machine-readable/SEO output).
- **FR-004**: Each publicly shown teacher MUST present, using dignified placeholders where a value is genuinely missing: a photo or placeholder, a biography, a stated and verifiable ijazah/riwayah, languages spoken, an availability indication, and a price tier. Ratings are shown only when real session-based data exists and MUST NOT be fabricated.
- **FR-005**: Teacher credentials MUST be presented as specific, checkable claims (named riwayah/sanad) rather than a generic certified label alone.
- **FR-006**: A real teacher with zero completed sessions MUST be presented honestly (e.g. a "New" treatment) and MUST NOT display a bare zero counter that reads as broken.
- **FR-007**: Public pages MUST display multiple distinct testimonials with internally consistent attribution (name/location), and MUST NOT repeat a single quote with conflicting attribution.
- **FR-008**: A testimonial that names or implies a specific customer/teacher MUST correspond to a real record; unsubstantiated quotes MUST NOT be presented as specific named customers.
- **FR-009**: A content area with no published items MUST NOT be promoted in primary navigation, hero, or footer, and MUST resume promotion automatically once it has content.
- **FR-010**: Visitors whose preferred language is not Arabic MUST be presented an English experience or an immediately visible, persistent language switch on arrival. "Not Arabic" is determined on first visit (no language cookie set) by the first `Accept-Language` entry whose primary subtag is not `ar` → English; when the top preference is Arabic or no preference is sent, Arabic (the canonical default) is kept.
- **FR-011**: A visitor's explicit language choice MUST be preserved across navigation and return visits and MUST override automatic detection.
- **FR-012**: The site MUST expose discoverable organizational credibility information: named leadership, an organizational identity, a child-safeguarding statement, and a privacy posture.
- **FR-013**: The site MUST provide an institutional/partnership contact path distinct from the consumer personal-email/messaging contact.
- **FR-014**: All changes MUST preserve existing Quran-text integrity and existing data-access protections (no public exposure of data that is not already public; identity continues to come from the authenticated session, not visitor input).

### Key Entities *(include if feature involves data)*

- **Teacher (public view)**: a presentable, published teacher — identity, photo/placeholder, biography, credentials (ijazah/riwayah/sanad), languages, availability, price tier, completed-session standing. Distinguished from non-public accounts (test/seed/unpublished/incomplete).
- **Testimonial**: an attributable statement of student experience — author name, location, optional referenced teacher, substantiation status.
- **Promotable content area**: a navigable surface (e.g. recorded courses) with a published/empty state that governs whether it is advertised.
- **Language preference**: a visitor's effective language — detected default plus explicit, persisted override.
- **Organization credibility set**: leadership, legal/organizational identity, safeguarding statement, privacy posture, partnership contact route.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero test/placeholder/unpublished teacher profiles are visible on any public surface (verified by an anonymous crawl of home, teachers list, and profile links).
- **SC-002**: 100% of publicly listed teachers display all six required presentation elements (photo/placeholder, bio, verifiable credential, languages, availability, price).
- **SC-003**: A first-time visitor can choose a teacher to contact/book using only public information, without registering first, in under 3 minutes.
- **SC-004**: At least several distinct, consistently-attributed testimonials are shown, with no single quote repeated under conflicting attribution anywhere on the site.
- **SC-005**: No promoted navigation/hero/footer link leads to an empty "nothing here yet" page.
- **SC-006**: A non-Arabic visitor reaches an understandable (English) experience within one action of landing, and their choice persists on return.
- **SC-007**: An institutional visitor can locate leadership, organizational identity, a safeguarding statement, a privacy posture, and a partnership contact path.
- **SC-008**: A re-run of the seven-persona review shows the test-teacher defect resolved by all reviewers and an average score improvement of at least +2 points over the 5.3 baseline.

## Assumptions

- The test/fixture accounts originate from end-to-end test or seed data that reached the production dataset; the durable fix is a structural exclusion rule on public reads, not a one-time row deletion.
- Real, credentialed teachers with zero completed sessions should remain visible (presented as "New") to avoid emptying a still-growing marketplace; only test/unpublished/incomplete profiles are hidden.
- Ratings/reviews require completed-session feedback; capturing a new review mechanism is **out of scope** for this feature. Profiles are built to display ratings when such data exists, but this feature ships profile credibility (photo, bio, credentials, availability, price) without inventing rating data.
- "Verifiable" credential means a specific, checkable claim (named riwayah/sanad and issuing authority where available); third-party live verification of certificates is out of scope.
- Language detection uses the visitor's stated browser language preference as the default signal; explicit choice always overrides and persists.
- Bilingual-UX reconciliation (constitution): Arabic remains the **canonical default** locale. US5 does not introduce new English-only content or remove any Arabic text — it only selects, on first visit, between the site's already-existing bilingual (AR/EN) content for a visitor whose browser clearly prefers a non-Arabic language. RESOLVED 2026-06-30: the constitution owner approved this and amended the Bilingual-UX rule (constitution **v1.3.0**, "Default-locale selection" clause) to explicitly permit `Accept-Language`-based first-visit selection. US5 is therefore unblocked with no remaining governance gate.
- Organizational-credibility content (leadership names, legal entity, safeguarding/privacy text) will be supplied by the business; this feature provides the surfaces and ensures they are discoverable.

## Out of Scope

- Any change to Quran text, ayah ranges, tashkeel/tajweed/waqf rendering, or memorization scheduling logic.
- Pricing changes, new payment/checkout flows, or subscription mechanics.
- A visual redesign or re-theming of the site.
- Building a new ratings/reviews capture system, a new messaging system, or a full B2B portal (only the credibility surfaces and a contact path are in scope).
