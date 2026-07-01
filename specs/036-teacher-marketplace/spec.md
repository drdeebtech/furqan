# Feature Specification: Teacher Searchable Marketplace

**Feature Branch**: `feat/036-teacher-marketplace`
**Created**: 2026-07-01
**Status**: Draft
**Closes**: #549

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Keyword Search (Priority: P1)

A parent or student visits `/teachers`, types a name or specialty keyword (e.g. "tajweed", "حفظ", "sister"), and immediately sees a filtered list of matching teacher cards with no page reload.

**Why this priority**: The primary conversion failure is undiscoverability. A student who cannot find a teacher matching their need leaves to a competitor. Keyword search is the fastest path from intent to match.

**Independent Test**: Navigate to `/teachers`, type "tajweed" in the search box, and confirm that only teachers whose profile mentions tajweed appear. Search for "xyz_no_match" and confirm the empty state with a helpful message appears.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor on `/teachers`, **When** they type "tajweed" in the search field, **Then** only teachers with "tajweed" in their name, bio, or specialties appear within 1 second.
2. **Given** a visitor searching in Arabic (e.g. "تجويد"), **When** they submit the query, **Then** matching teachers appear with unaccented Arabic matching (diacritics-insensitive).
3. **Given** a visitor enters a query that matches no teachers, **When** the results load, **Then** a friendly empty state appears explaining how to get help finding a teacher — not a generic "no results" message.
4. **Given** a visitor clears the search box, **When** it is empty, **Then** all published teachers are shown again (reset to default listing).

---

### User Story 2 — Filter by Language, Gender, Specialty, Price (Priority: P2)

A parent wants to narrow the teacher list by one or more attributes — e.g. "female teacher, Arabic speaker, teaching hifz, under $30/session" — without typing a keyword.

**Why this priority**: Many parents have hard requirements (gender for cultural reasons, language for communication) that a keyword search alone cannot satisfy. Filters convert browsers into bookers by reducing irrelevant noise.

**Independent Test**: Apply the "female" gender filter and confirm that only teachers with gender set to female appear. Combine with a "hifz" specialty filter and confirm results satisfy both constraints.

**Acceptance Scenarios**:

1. **Given** a visitor on `/teachers`, **When** they select "Female" from the gender filter, **Then** only female teachers appear.
2. **Given** a visitor selects "Hifz" specialty filter, **When** they also set a maximum price of $30, **Then** only teachers offering hifz AND with a session price at or below $30 appear.
3. **Given** a visitor applies filters, **When** they copy and paste the URL into a new tab, **Then** the same filters are pre-applied (filter state is in the URL).
4. **Given** a visitor applies filters that produce no results, **When** the empty state renders, **Then** a "Clear all filters" shortcut is prominently shown.
5. **Given** a mobile visitor on a small screen, **When** they tap "Filters", **Then** a drawer slides up with all filter controls accessible by touch.

---

### User Story 3 — Ranked Results (Priority: P3)

A visitor who searches or browses without filters sees the most active and relevant teachers first, not an arbitrary order.

**Why this priority**: An unranked list puts inactive or incomplete profiles ahead of excellent teachers. Ranking by activity (sessions completed) surfaces social proof automatically and rewards teachers who engage with the platform.

**Independent Test**: Inspect the default teacher list (no search, no filters). Confirm teachers are sorted descending by completed session count. Search for a keyword and confirm the ranked order reflects both relevance and activity.

**Acceptance Scenarios**:

1. **Given** a visitor loads `/teachers` with no query or filters, **When** results appear, **Then** teachers are ordered by completed sessions descending (most active first).
2. **Given** a visitor enters a search query, **When** results appear, **Then** teachers with the keyword in their name rank above keyword matches only in their bio.
3. **Given** teacher A has 50 sessions and teacher B has 5 sessions and identical keyword relevance, **Then** teacher A appears above teacher B.

---

### Edge Cases

- What happens when the search service is slow or temporarily unavailable? → The existing teacher list (unfiltered, cached) remains visible; a non-blocking error indicator appears without breaking the page.
- What happens when a teacher's profile is incomplete (no bio, no price set)? → Incomplete profiles are excluded from public search results until the minimum required fields are filled.
- What happens when a visitor types a single character? → Search triggers only after 2+ characters to avoid excessive low-signal results.
- What happens on very slow connections? → Skeleton loading cards hold the layout to prevent content shift. Results replace skeletons when data arrives.
- What happens when a visitor applies a filter that makes the price range impossibly narrow (min > max)? → The filter is rejected with an inline validation message; no search is fired.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Visitors MUST be able to search the teacher directory by entering a text query that matches against teacher name, bio, and specialties in both Arabic and English.
- **FR-002**: Search MUST be diacritics-insensitive for Arabic queries (searching "حفظ" matches profiles containing "حِفْظ").
- **FR-003**: Visitors MUST be able to filter results by language of instruction, teacher gender, teaching specialty, and per-session price range; all filters MUST be independently applicable and AND-combined.
- **FR-004**: Active filter and search state MUST be reflected in the page URL so links are shareable and the browser back button restores the previous state.
- **FR-005**: Default (unfiltered) results MUST be ranked by completed session count descending; keyword searches MUST additionally weight name matches above bio matches.
- **FR-006**: The ranking function MUST accept an optional average review score parameter (defaulting to zero when absent) so that spec 037 (reviews) can plug in without changing this feature.
- **FR-007**: The teacher listing MUST show a loading skeleton while results are fetching; the skeleton MUST match the card layout to prevent content shift.
- **FR-008**: When no results match the current query/filters, the page MUST display a friendly empty state that explains how to contact support to find a teacher — not a generic "no results" message.
- **FR-009**: The filter UI MUST be presented as a collapsible bottom drawer on mobile-width screens and as a sidebar on desktop-width screens.
- **FR-010**: All filter labels and empty-state messages MUST be available in Arabic (RTL) and English, following the existing language toggle behaviour of the site.
- **FR-011**: Only published, active teacher profiles MUST appear in search results; profiles with missing required fields (bio, price, photo) MUST be excluded.
- **FR-012**: The search and filter interface MUST be keyboard-navigable with appropriate ARIA labels, so assistive-technology users can operate every control.
- **FR-013**: Pagination MUST default to 12 results per page with page navigation controls; the current page MUST be preserved in the URL.

### Key Entities

- **Teacher Card**: The public-facing summary of a teacher — name, photo, specialties, languages, gender, session price, completed session count, and a link to their full profile. Displayed in search results.
- **Search Query**: A free-text string entered by the visitor. Matched against teacher name, bio, and specialties. Optional — absence returns all published teachers.
- **Filter Set**: A collection of optional constraints (language, gender, specialty, price_min, price_max) that narrow the result set. Stored in URL search parameters.
- **Specialty**: A category label representing a teaching focus (e.g. Tajweed, Hifz, Ijazah, Quran for Beginners). Drawn from a fixed list in both Arabic and English; no free-text specialty input.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A visitor can find a teacher matching their language and specialty in under 30 seconds from landing on `/teachers`.
- **SC-002**: Search results appear within 1 second of the visitor finishing their query (no loading spinner visible for typical searches).
- **SC-003**: Filters applied on mobile are as quick to activate as on desktop (drawer open-to-result under 500 ms on a mid-range device).
- **SC-004**: The page produces no layout shift during result loading (Cumulative Layout Shift score of 0 for the teacher card area).
- **SC-005**: Every filter control and search input is operable by keyboard alone with visible focus indicators.
- **SC-006**: Arabic queries return correct results at the same speed and accuracy as equivalent English queries.

## Assumptions

- Teacher profiles already contain the fields needed for filtering (language, gender, specialty, price, session count) — this spec adds search/filter UI, not new profile fields.
- The existing `/teachers` page already shows published-only teachers; this spec inherits that gate and extends it without relaxing it.
- Specialties are drawn from a finite, curated list (not free-text) agreed upon with the teaching team; the list includes at minimum: Tajweed, Hifz, Quran for Beginners, Ijazah, and Arabic Language.
- Price is stored as a single per-session rate per teacher; per-package or tiered pricing is out of scope.
- A teacher's photo is a hard requirement for appearance in search results — profiles without a photo are excluded regardless of other filters.
- Reviews and average scores are not yet available (spec 037); the ranking formula reserves a slot for them but scores default to zero for this spec.
- Guest visitors (unauthenticated) are the primary audience for this feature; no login is required to search or filter.
