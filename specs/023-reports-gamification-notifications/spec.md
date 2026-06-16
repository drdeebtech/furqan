# Feature Specification: Reports, Gamification & Notifications

**Feature Branch**: `023-reports-gamification-notifications`
**Created**: 2026-06-16
**Status**: Draft
**Phase**: م٦ (reports, encouragement, notification content/channels) of the Subscription + Courses Pivot
**Plan**: `/home/drdeeb/.claude/plans/you-are-acting-as-shimmering-cray.md`
**Input**: Build guardian-facing reports (teacher notes + monthly level assessment), course-completion certificates with a next-product suggestion, lightweight gamification (per-juz / per-level appreciation certificates + an honor board), and the notification **content + delivery channels** (in-app, email, WhatsApp via the existing n8n automation layer) for triggers emitted by earlier phases (dunning/pre-suspension, expiry "continue?" prompt, payment-retry, absence/excuse outcomes) plus this spec's own triggers (monthly report ready, certificate earned). Reuse `automation_logs`, `emitEvent`, the n8n webhook intake, and the existing `notifications` surface.

---

## Context & Scope

Earlier phases produce the **events** (a payment failed, a subscription month closed, an absence was excused). They do not define what the guardian or student actually **receives**. This spec owns the human-visible layer on top of those events: the **reports** a guardian reads, the **certificates** a student earns, the **honor board** that motivates, and the **content + channel routing** for every notification — including WhatsApp, which the current `notifications` surface does not yet support.

This is a **light, encouragement-first** phase. Certificates here are **simple appreciation certificates**, not formal ijazah/sanad — the ijazah/sanad path (plan #39) is **deferred and explicitly out of scope**. Reports are a teacher-notes feed plus a once-per-billing-month level assessment. Notifications consume events that other specs emit; this spec defines their copy (Arabic-first, RTL), their channel set, and idempotent delivery.

**In scope:**
- **Guardian reports**: per-student teacher notes visible to the linked guardian; a monthly level-assessment report generated after each subscription month closes.
- **Course completion**: on completing a defined memorization course, issue a completion certificate and surface a next-product/next-surah suggestion.
- **Gamification**: appreciation certificate after each completed juz and after any level milestone (encouragement); an **honor board** highlighting top/diligent students.
- **Certificates (simple)**: appreciation + course-completion certificate records, citing exact `surah:ayah`/juz read **from canonical structure** (`src/lib/quran/`); fully RTL/Arabic renderable.
- **Notification content & channels**: in-app + email + **WhatsApp**, routed through n8n; idempotent per (recipient, trigger, subject) using the existing `automation_logs` idempotency ledger.
- **Notification triggers this spec owns the content/delivery for** (events emitted elsewhere): dunning / pre-suspension alert (events from 018), subscription-expiry "continue?" prompt (plan #8, sent before period end), payment-retry / dunning escalation (plan #25), absence/excuse outcome (events from 021), and this spec's own monthly-report-ready and certificate-earned triggers.

**Explicitly out of scope (owned by other specs):**
- Billing, grants, and **emission** of billing/subscription events → **spec 018** (م١). This spec consumes those events; it never emits or mutates billing state.
- Pricing catalog / course-product definitions and the "next product" inventory → **spec 019** (م٢). This spec references a course/product as defined there; it does not define the catalog.
- Scheduling, fixed-teacher assignment, cohorts → **spec 020** (م٣).
- Attendance, excuses, payroll and the **emission** of absence/excuse events → **spec 021** (م٤). This spec consumes those events.
- Assessment / instant / specialized single sessions → **spec 022** (م٥).
- Existing-user migration & cutover → **spec 024** (م٧).
- **Ijazah / sanad** (formal certification, isnād chain) → **deferred (plan #39); explicitly NOT built here.**

**Three lenses** (per AGENTS.md §1):
- 🛠 **Engineer**: reuse `notifications`, `automation_logs` (idempotency_key UNIQUE), `emitEvent`, and the verified n8n intake; new tables ship RLS in the same migration; service-role-only writes for system-generated artifacts; fail-closed delivery accounting.
- 📖 **Quran teacher**: every surah/juz/ayah cited on a certificate or report MUST come from canonical structure in `src/lib/quran/` (`surahs.ts`, `ayah-counts.ts`) — never generated, never hardcoded; tashkeel/waqf preserved byte-for-byte; an appreciation certificate is encouragement, never a claim of ijazah.
- 🎓 **Platform expert**: a guardian must clearly see their child's progress and standing; encouragement must feel earned and fair; all copy renders correctly in Arabic RTL across in-app, email, and WhatsApp.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Guardian reads teacher notes and the monthly assessment (Priority: P1)

A guardian opens their child's report and sees the teacher's notes for that student plus a monthly level-assessment summary generated after each subscription month closes.

**Why this priority**: Visibility into a child's progress is the core value a paying guardian expects each month; without it the subscription feels opaque. Learner-continuity and platform lenses make this the MVP slice.

**Independent Test**: Link a guardian to a student, have a teacher save notes, close a billing month → verify the guardian (and only that guardian) can read the notes and a single monthly assessment for that month, rendered RTL.

**Acceptance Scenarios**:

1. **Given** a teacher has saved notes for a student, **When** the linked guardian opens the report, **Then** they see those notes scoped to their own student only — never another family's.
2. **Given** a subscription month closes (event from 018), **When** the monthly report runs, **Then** exactly one level-assessment report exists for that student+month, and a "report ready" notification is delivered once.
3. **Given** a guardian not linked to a student, **When** they attempt to read that student's report, **Then** access is denied (RLS).

---

### User Story 2 - Student earns an appreciation certificate per juz / level (Priority: P1)

When a student completes a juz or reaches a level milestone, the platform issues a simple appreciation certificate citing the exact juz / `surah:ayah` range completed, drawn from canonical Quran structure, and notifies the student and guardian.

**Why this priority**: Encouragement is the motivational engine of the phase and the most visible "delight" moment; equal P1 with reports. The 📖 lens is load-bearing — a wrong ayah count on a certificate is a Quran-integrity failure.

**Independent Test**: Mark a juz complete for a student → verify exactly one appreciation certificate is created, its cited range matches `src/lib/quran/ayah-counts.ts` for that juz, and a "certificate earned" notification fires once.

**Acceptance Scenarios**:

1. **Given** a student completes juz N, **When** the certificate is issued, **Then** the cited surah/ayah boundaries equal the canonical values for juz N (no generated or hardcoded counts) and the certificate renders correctly in Arabic RTL.
2. **Given** a juz is re-marked complete (duplicate trigger), **When** issuance runs again, **Then** **no** second certificate is created (idempotent per student+milestone).
3. **Given** a certificate is issued, **When** notifications are sent, **Then** the student and the linked guardian each receive it once across the configured channels.

---

### User Story 3 - Course completion issues a certificate and suggests the next product (Priority: P2)

When a student completes a defined memorization course, the platform issues a course-completion certificate and surfaces a suggested next product/surah so the learner knows where to go next.

**Why this priority**: Completing a paid course is a major milestone and a natural upsell/continuation moment, but it occurs less often than per-juz encouragement. P2.

**Independent Test**: Mark a course (as defined in 019) complete for a student → verify one completion certificate exists with the course's covered range cited from canonical structure, and a next-product suggestion is presented.

**Acceptance Scenarios**:

1. **Given** a student completes course C, **When** completion is recorded, **Then** exactly one course-completion certificate is issued and a next-product/next-surah suggestion is surfaced.
2. **Given** the next-product suggestion, **When** no further product applies, **Then** the suggestion degrades gracefully to a neutral "well done" state (never a broken link or fabricated product).
3. **Given** a course-completion certificate, **When** rendered, **Then** any cited surah:ayah range is exact per `src/lib/quran/` and the certificate is fully RTL.

---

### User Story 4 - Honor board motivates top / diligent students (Priority: P2)

The platform shows an honor board recognizing top and diligent students, refreshed on a defined cadence, to encourage consistency.

**Why this priority**: A motivation amplifier that raises engagement, but the platform is usable without it. P2.

**Independent Test**: With several students having recorded progress, refresh the honor board → verify it lists qualifying students by the defined ranking and exposes only the privacy-appropriate fields.

**Acceptance Scenarios**:

1. **Given** students with recorded progress, **When** the honor board is computed, **Then** it ranks by the defined diligence/achievement metric and shows only display-safe fields (no private contact data).
2. **Given** a student opts out of public recognition, **When** the board renders, **Then** that student is excluded. *(Opt-out behavior detail in [NEEDS CLARIFICATION].)*

---

### User Story 5 - Lifecycle & billing notifications reach the guardian on the right channels (Priority: P1)

Guardians receive timely, idempotent notifications for events emitted by other phases — pre-suspension/dunning, the expiry "continue?" prompt, payment-retry, and absence/excuse outcomes — across in-app, email, and WhatsApp.

**Why this priority**: A silently dropped child mid-program or a missed renewal prompt is the top churn/harm driver (mirrors 018 Story 3); this spec is where those events become an actual message. P1.

**Independent Test**: Emit each owned trigger event (simulated from 018/021) → verify a single notification is produced per (recipient, trigger, subject), routed to the configured channels, with retries not producing duplicates.

**Acceptance Scenarios**:

1. **Given** a `payment_failed`/dunning event from 018, **When** notification routing runs, **Then** a pre-suspension alert is delivered once per recipient on the configured channels, recorded in the idempotency ledger.
2. **Given** the same event is re-delivered (n8n/webhook retry), **When** routing runs again, **Then** the existing `automation_logs.idempotency_key` causes a **skipped** no-op — no duplicate message.
3. **Given** a subscription nears period end (expiry "continue?" trigger, plan #8), **When** the prompt is sent **before** period end, **Then** the guardian receives a single "continue?" notification with the renew path.
4. **Given** an absence/excuse outcome event from 021, **When** routing runs, **Then** the guardian is notified of the outcome (excused / make-up scheduled) once.
5. **Given** a WhatsApp send fails at n8n, **When** the failure returns, **Then** it is recorded (status `failed`) and surfaced — never silently swallowed — and is retry-safe under the idempotency key.

---

### Edge Cases

- **Duplicate trigger / webhook retry**: every certificate issuance, monthly report, and notification MUST be idempotent — re-delivery yields a `skipped` no-op via the existing unique idempotency key. No double certificates, no double messages.
- **Juz/level boundary correctness**: a certificate's cited range MUST validate against `src/lib/quran/ayah-counts.ts`; a range that cannot be validated MUST fail loudly, never render an approximate or fabricated boundary.
- **Guardian↔student linkage ambiguity**: a report or notification MUST resolve to the correct guardian/student deterministically (reuse existing linkage), or be withheld — never leak one family's data to another.
- **Channel not yet supported**: the existing `notifications.channel` check constraint currently allows only `in_app/email/push`; adding **WhatsApp** requires extending the channel set (migration) without breaking existing rows.
- **Email header / WhatsApp injection**: any user/teacher-authored value placed into a subject/header MUST be stripped of CR/LF; message bodies are otherwise safe.
- **n8n unreachable**: a delivery attempt that cannot reach n8n MUST be recorded `failed` (not `succeeded`), visible in Sentry/logs, and safely retryable — never marked delivered.
- **Out-of-order events**: a "month closed" arriving after a later correction MUST NOT overwrite a newer assessment; reports are append/version-safe, never silently regressed (progress is merged, never overwritten — AGENTS.md §4).
- **Honor-board privacy**: only display-safe fields are exposed; opted-out students are excluded.
- **Course with no defined next product**: degrade to a neutral completion state; never fabricate a product or surah.

---

## Requirements *(mandatory)*

### Functional Requirements — Reports

- **FR-001**: System MUST let a teacher record per-student notes and MUST make those notes readable by the **linked guardian** of that student (and the student) — and by no other family — enforced by RLS.
- **FR-002**: System MUST generate **one** monthly level-assessment report per student per closed subscription month, triggered by the month-close event emitted by spec 018. Re-delivery of that event MUST NOT create a second report for the same student+month.
  > ⛔ **BLOCKING DEPENDENCY:** no month-close emitter is currently defined in spec 018 — this spec only *consumes* the event. Without an upstream emitter, the monthly report never fires (dead feature). Confirm or add the month-close event in spec 018 BEFORE implementing FR-002 (tasks T012). This is a hard cross-spec dependency, not an open question.
- **FR-003**: A monthly report MUST summarize the student's progress for that month and MUST reference any surah/juz/ayah using values read from canonical structure (`src/lib/quran/`) — never generated or hardcoded counts.
- **FR-004**: On generation of a monthly report, the system MUST deliver a single "report ready" notification to the guardian via the routing in FR-013/FR-014.

### Functional Requirements — Certificates & Gamification

- **FR-005**: System MUST issue a **simple appreciation certificate** when a student completes a juz, and after any defined level milestone, as encouragement. The certificate MUST cite the exact juz / `surah:ayah` range completed, validated against `src/lib/quran/ayah-counts.ts`; an unvalidatable range MUST fail loudly rather than render an approximate value.
- **FR-006**: System MUST issue a **course-completion certificate** when a student completes a defined memorization course (course defined in spec 019), citing the course's covered range from canonical structure, and MUST surface a **next-product/next-surah suggestion**; when none applies it MUST degrade to a neutral completion state.
- **FR-007**: Certificate issuance MUST be **idempotent** per (student, milestone-type, milestone-key) using the existing `automation_logs.idempotency_key` unique ledger — a duplicate trigger yields a `skipped` no-op and never a second certificate.
- **FR-008**: All certificates MUST be **simple appreciation artifacts**, NOT formal ijazah/sanad; the system MUST NOT represent them as ijazah and MUST NOT implement isnād/sanad chains (deferred per plan #39).
- **FR-009**: Every certificate and report MUST render correctly in **Arabic RTL**, preserving tashkeel/waqf marks byte-for-byte for any rendered Quran text.
- **FR-010**: System MUST compute an **honor board** ranking top/diligent students by a defined achievement/diligence metric, exposing only display-safe fields (no private contact data) and excluding students who have opted out of public recognition.

### Functional Requirements — Notifications (content & channels)

- **FR-011**: System MUST support delivery on **three channels** — in-app, email, and **WhatsApp** — extending the existing `notifications.channel` set to include WhatsApp (migration), without breaking existing rows; email and WhatsApp dispatch route through the existing **n8n** automation layer.
- **FR-012**: System MUST own the **content** (Arabic-first, RTL) for each notification trigger it serves: dunning/pre-suspension alert, expiry "continue?" prompt, payment-retry/dunning escalation, absence/excuse outcome, monthly-report-ready, and certificate-earned.
- **FR-013**: For each owned trigger, the system MUST consume the **event emitted by the owning spec** (018 for billing/dunning/expiry/retry; 021 for absence/excuse) and MUST NOT itself emit or mutate billing/attendance state. The expiry "continue?" prompt MUST be sent **before** the period end.
- **FR-014**: Notification delivery MUST be **idempotent** per (recipient, trigger, subject) via the existing `automation_logs` unique idempotency key, with status one of `started/succeeded/failed/skipped`; a duplicate/replayed trigger MUST resolve to `skipped`.
- **FR-015**: A delivery attempt that cannot reach n8n (or that n8n reports failed) MUST be recorded `failed` and surfaced through the existing error pipeline — never silently swallowed and never marked succeeded; it MUST be retry-safe under the idempotency key.
- **FR-016**: Any user/teacher-authored value placed into an email subject/header or WhatsApp template field MUST be stripped of CR/LF to prevent header/template injection; bodies are otherwise unmodified.
- **FR-017**: Event names used for emission/consumption MUST come from the **shared typed event surface** (AGENTS.md §4 — `FurqanEvent`/the shared `Events` enum), never string literals introduced ad hoc.

### Functional Requirements — Data & Security

- **FR-018**: Every **new** table (certificates, honor-board entries, monthly-report records, and any report-notes table) MUST ship **Row Level Security enabled with policies in the same migration**: a student reads only their own artifacts; a linked guardian reads only their linked student's artifacts; the honor board exposes only display-safe public fields; **all writes for system-generated artifacts (certificates, reports, honor board) are service-role only**.
- **FR-019**: RLS policies MUST use the `( select auth.uid() )` initplan pattern, `private.is_admin()` for admin reads, PK `uuid`, FKs to `public.profiles(id)`, and `public.set_updated_at()` for `updated_at`; new timestamped migrations land after the `20260428000000_remote_baseline.sql` baseline.
- **FR-020**: Identity/achievement columns on certificate and report rows MUST be protected from client mutation following the existing `BEFORE UPDATE OF` guard pattern (service-role and migrations exempt) — a student MUST NOT be able to forge or alter an earned certificate or assessment.
- **FR-021**: Regenerated database types MUST be produced for the new tables (`npm run db:types`) and `tsc --noEmit`, `lint`, and `test:unit` MUST pass; `sb:advisors` MUST be clean for the new tables.

### Non-Functional / Security Requirements

- **NFR-001**: Inbound n8n callbacks (if any) MUST verify `X-N8N-Secret` via the existing constant-time `safeCompareSecret` before any side effect (fail-closed); the service-role key remains server-only.
- **NFR-002**: No certificate, report, or notification side effect may occur for a duplicate trigger once the idempotency key is present (verified by an automated replay test).
- **NFR-003**: Canonical Quran structure is the **only** source for any cited juz/surah:ayah on a certificate or report; a unit test MUST assert cited boundaries equal `src/lib/quran/ayah-counts.ts` values, and that no count is hardcoded.
- **NFR-004**: Critical paths (idempotent issuance, fail-closed delivery accounting, guardian-scoped RLS, RTL rendering) MUST be covered by unit/integration tests.

### Key Entities *(data involved)*

- **Certificate**: a student's earned artifact — type (appreciation-juz / appreciation-level / course-completion), the milestone key (juz number, level id, or course id), the canonical cited range, issue timestamp, and recipient student. Relationships: belongs to a student (profiles); one per (student, type, milestone-key).
- **Monthly Report**: one per student per closed subscription month — period bounds, the level-assessment summary, and the linked student/guardian. Append/version-safe; never silently regressed.
- **Report Note** *(verify against existing notes surface before adding)*: a teacher-authored per-student note made visible to the linked guardian.
- **Honor Board Entry**: a display-safe ranking record — student display fields, the diligence/achievement metric, period, and opt-out flag.
- **Notification** (reused — `public.notifications`): `user_id`, `type` (`notif_type`), `channel text[]` (extended to include WhatsApp), `title`, `body`, `data`, `is_read`, `expires_at`.
- **Automation Log** (reused — `public.automation_logs`): the `idempotency_key`-unique delivery/issuance ledger with status `started/succeeded/failed/skipped`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A guardian linked to a student can read that student's teacher notes and the monthly assessment, and a non-linked user **cannot** — verified across **100%** of RLS test cases.
- **SC-002**: After a billing month closes, exactly **one** monthly report and exactly **one** "report ready" notification exist per student+month, even after event re-delivery.
- **SC-003**: Every appreciation/course certificate cites a juz/surah:ayah range that **exactly** matches `src/lib/quran/ayah-counts.ts` — **0** fabricated or hardcoded counts, asserted by an automated test.
- **SC-004**: Replaying any issuance or notification trigger produces **0** duplicate certificates, reports, or messages across **100%** of retries (idempotency-ledger `skipped`).
- **SC-005**: Each owned notification trigger (dunning, expiry "continue?", payment-retry, absence/excuse, report-ready, certificate-earned) delivers on its configured channels (in-app/email/WhatsApp) for **100%** of recipients, with the expiry prompt sent **before** period end.
- **SC-006**: An n8n/WhatsApp delivery failure is recorded `failed` and surfaced in **100%** of failure cases — **0** silently-succeeded false positives.
- **SC-007**: Every certificate, report, and notification renders correctly in Arabic RTL with preserved tashkeel/waqf — verified manually on the critical flows.
- **SC-008**: The honor board exposes **0** private contact fields and excludes **100%** of opted-out students.

---

## Assumptions

- **Reuses the notifications surface**: `public.notifications` (`type notif_type`, `channel text[]`, `title`, `body`, `data`, `is_read`, `expires_at`) is the in-app store; its `channel` check constraint is extended to add WhatsApp without altering existing rows.
- **Reuses the automation layer**: `emitEvent` (`src/lib/automation/emit.ts`) for event emission, the n8n webhook intake (`src/app/api/webhooks/n8n/route.ts`, `X-N8N-Secret` via `safeCompareSecret`), and `automation_logs` (`idempotency_key` UNIQUE; status `started/succeeded/failed/skipped`) for idempotent delivery/issuance.
- **Typed event names**: emission/consumption use the shared `FurqanEvent`/`Events` surface (AGENTS.md §4); any new trigger names are added there, never as string literals.
- **Canonical Quran structure**: all cited juz/surah:ayah read from `src/lib/quran/surahs.ts` and `ayah-counts.ts` (mirrored to `quran_surahs_reference`); never generated, never hardcoded elsewhere.
- **Events are emitted by the owning specs**: billing/dunning/expiry/payment-retry events by 018; absence/excuse outcome events by 021. This spec is a **consumer + content/channel layer**; it never emits or mutates billing/attendance state.
- **Course/product definitions** (including the "next product" inventory) come from spec 019; this spec references a completed course, it does not define the catalog.
- **Guardian↔student linkage** uses the existing profile/family relationship; this spec does not redefine it.
- **Certificates are simple appreciation artifacts**; ijazah/sanad (plan #39) is deferred and not built.
- **Adjustable values** (honor-board cadence/metric thresholds, notification copy toggles) are data/settings (`platform_settings`), not hardcoded.
- **Migration topology**: new timestamped migrations land after `20260428000000_remote_baseline.sql`; the baseline is never `db push`ed.

## Dependencies

- **Existing tables**: `public.notifications`, `public.automation_logs`, `public.profiles`, `platform_settings`, the existing teacher-notes/session-notes surface (verify exact table before adding a new one), and `quran_surahs_reference`.
- **Existing code**: `src/lib/automation/emit.ts` (`emitEvent`, `FurqanEvent`), `src/app/api/webhooks/n8n/route.ts` (`safeCompareSecret`), `src/lib/security/secrets.ts`, `src/lib/quran/surahs.ts` + `ayah-counts.ts`, `src/lib/supabase/admin.ts`, `src/lib/settings.ts`.
- **Existing n8n flows**: email and WhatsApp dispatch are implemented in n8n; this spec supplies the payload/content and consumes delivery status.
- **Upstream specs (event sources)**: **spec 018** (billing/dunning/expiry/payment-retry events) and **spec 021** (absence/excuse outcome events) MUST emit the triggers this spec consumes; **spec 019** defines the courses/products referenced by certificates and the next-product suggestion.
- **Out of scope here**: ijazah/sanad (plan #39, deferred).

## Clarifications Needed

- **Certificate format** *(resolved)*: in-app shareable card — no PDF in this phase. PDF deferred.
- **WhatsApp provider/template specifics** — [NEEDS CLARIFICATION]: which provider does the existing n8n flow use, and are pre-approved message templates required? Resolve before `/speckit-plan 023`.
- **Honor-board opt-out** *(resolved)*: **opt-out by default** — students visible on the board unless they (or guardian for minors) explicitly opt out. Opt-out is per-student, guardian-controlled for minors.

## Clarifications

### Session 2026-06-16 (analyze remediation)

- Q: `notifications.channel` widening — array or scalar CHECK? → A: column is ALREADY `text[]` with a correct `CHECK (channel <@ ARRAY['in_app','email','push'])` (VERIFIED 2026-06-16). The widening migration MUST follow the `<@` subset form to add `'whatsapp'`; do NOT use scalar `= ANY`. New allowed set: in_app / email / push / whatsapp.
- Q: Canonical idempotency-key schema? → A: `notif:{recipientId}:{trigger}:{subjectKey}` per FR-014 (recipient, trigger, subject). Fix contracts/api.md §7 to match.
- Q: Month-close trigger emitter (FR-002)? → A: requires an upstream month-close event from spec 018; no emitter is currently defined. Recorded as a dependency to verify/add before US covering FR-002 is built.
- Q: Honor-board achievement metric (FR-010)? → A: formula undefined; recorded as OPEN pending product input (e.g. juz completed × consistency).
- Q: WhatsApp provider [NEEDS CLARIFICATION]? → A: provider-agnostic via n8n; concrete template deferred to the n8n owner.
