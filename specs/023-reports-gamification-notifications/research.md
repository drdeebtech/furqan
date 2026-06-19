# Research: Reports, Gamification & Notifications (Spec 023)

**Phase**: م٦ | **Generated**: 2026-06-16 | **Spec**: `specs/023-reports-gamification-notifications/spec.md`

---

## R-001 — Certificate & Report Idempotency via `automation_logs`

**Decision**: Reuse the existing `automation_logs.idempotency_key UNIQUE` ledger for all certificate issuances and monthly-report generations. Key format:
- Certificate: `cert:{student_id}:{certificate_type}:{milestone_key}` e.g. `cert:abc123:appreciation_juz:30`
- Monthly report: `report:{student_id}:{year}:{month}` e.g. `report:abc123:2026:6`

Flow: INSERT into `automation_logs` with `status='started'`; if UNIQUE constraint fires → set `status='skipped'`, no artifact created. On successful artifact creation → UPDATE `status='succeeded'`. On failure → UPDATE `status='failed'`.

**Rationale**: `automation_logs` already has `idempotency_key UNIQUE` and `status` enum `started/succeeded/failed/skipped`. No new idempotency table needed. Reusing the same ledger keeps delivery accounting and issuance accounting in one place.

**Alternatives considered**:
- Separate `certificate_issuance_log` table: duplicates the idempotency pattern already present in `automation_logs` — rejected.
- Unique index on `certificates(student_id, certificate_type, milestone_key)`: sufficient for insert-level guard but doesn't cover the notification-delivery idempotency half — use both.

**Scale check**: `automation_logs` rows grow at (students × events/month); at 50k students with 2 events/month = 100k rows/month. B-tree on `idempotency_key` makes conflict detection O(log N) — acceptable.

---

## R-002 — WhatsApp Channel Extension to `notifications`

**Decision**: Extend the `notifications.channel` CHECK constraint to include `'whatsapp'` via migration:
```sql
ALTER TABLE notifications DROP CONSTRAINT notifications_channel_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_channel_check
  CHECK (channel <@ ARRAY['in_app','email','push','whatsapp']);
```
WhatsApp dispatch routes through the existing n8n webhook (`src/app/api/webhooks/n8n/route.ts`) — no new endpoint. n8n holds the provider credentials and pre-approved templates.

> **Note (2026-06-16):** `channel` is `text[]`, so the constraint MUST use the array subset operator `<@` (per-element membership), NOT scalar `= ANY(...)`. The verified production constraint is `CHECK (channel <@ ARRAY['in_app','email','push'])`; this migration widens it to add `'whatsapp'` in the same `<@` form.

**Rationale**: DROP + re-ADD CHECK is the standard Postgres pattern for widening a constraint without touching existing rows. Old rows satisfy the new constraint because their channel values are still in the array. No data migration needed.

**Alternatives considered**:
- Separate `whatsapp_notifications` table: fragments the notification surface and duplicates RLS — rejected.
- `channel text[]` (array column): spec already uses `channel text[]` on `notifications` — the CHECK applies to each element. The migration extends the element CHECK.

**WhatsApp provider**: [NEEDS CLARIFICATION] in spec 023 — provider unknown at spec time. Migration and code are provider-agnostic; n8n owns the provider credential. This spec ships the channel record + payload routing; n8n handles the send.

---

## R-003 — Canonical Quran Range Sourcing for Certificates

**Decision**: All juz/surah:ayah cited on certificates are read at generation time from `src/lib/quran/ayah-counts.ts` (and `surahs.ts`). A certificate generation function receives a `juz_number` or `course_id`, looks up the canonical boundary in those files, and stores `cited_range_start` and `cited_range_end` as `surah:ayah` strings. A unit test asserts each certificate's cited range equals the canonical `ayah-counts.ts` value for that juz — never a hardcoded count.

**Rationale**: AGENTS.md §2: Quran text and surah/ayah facts are never generated or hardcoded by a model. Any fabricated count on a certificate is a Quran-integrity failure. The canonical reference is the only allowed source.

**Alternatives considered**:
- Hardcode juz boundaries in the migration seed: rejected — any error is undetectable and persists silently.
- Read from `quran_surahs_reference` DB table: acceptable fallback, but `src/lib/quran/ayah-counts.ts` is the primary authoritative source and avoids a DB round-trip.

---

## R-004 — Honor Board Privacy & Opt-Out

**Decision**: `honor_board_entries` table includes `is_opted_out boolean NOT NULL DEFAULT false`. Students are visible on the board by default (opt-out model per resolved clarification). A student (or guardian for a minor, via `guardian_children`) can set `is_opted_out = true` via a dedicated endpoint. Honor board queries filter `WHERE is_opted_out = false`. Only display-safe columns are exposed: `display_name`, `avatar_url`, `achievement_metric`, `rank_period` — no email, phone, or contact data.

**Rationale**: Resolved decision: opt-out by default (students visible unless they/guardian opt out). Guardian-controlled for minors via `guardian_children` join — guardian sets opt-out on child's behalf. Honor board is a motivational surface; default visibility maximises encouragement while respecting explicit requests for privacy.

**Alternatives considered**:
- Opt-in (hidden by default): maximises privacy but reduces motivational value; spec resolved in favor of opt-out.
- Separate `honor_board_opt_outs` table: over-engineering; single column on the entry row is simpler and atomic.

---

## R-005 — Typed Event Routing Pattern (n8n)

**Decision**: All event emission uses `emitEvent(FurqanEvent.X, payload)` from `src/lib/automation/emit.ts`. New `FurqanEvent` enum entries added to the shared events file: `MonthlyReportReady`, `CertificateEarned`, `HonorBoardUpdated`. This spec also **consumes** (does not emit) `PaymentFailed`, `SubscriptionExpiring`, `AbsenceOutcome` — events emitted by specs 018 and 021. Consumption is via the existing n8n webhook intake handler (`src/app/api/webhooks/n8n/route.ts`) which receives n8n callbacks and routes by event type.

No new webhook endpoint or secret. All events route through a single webhook path with `X-N8N-Secret` verification via `safeCompareSecret`.

**Rationale**: AGENTS.md §4: typed event names only — one shared enum, no string literals. Using string literals would allow silent drift between emitter and consumer.

**Alternatives considered**:
- Separate webhook per notification type: fragments routing and multiplies secrets — rejected.
- Direct database insert for notifications (skip n8n): loses the existing email/WhatsApp dispatch infrastructure in n8n — rejected.

---

## R-006 — 2026-06-19 clarification decisions (post-clarify)

Five decisions from the 2026-06-19 `/speckit-clarify` pass. Spec §Clarifications "Session 2026-06-19" is the source of truth; this section captures the research rationale.

### R-006.1 — `failed` row non-terminal (CHK032 retry-vs-lock)

**Decision**: `failed` MUST be retry-safe under the idempotency key. Spec 023 ships **spec-local delete-and-retry** (on a `failed` row for the same key, the dispatcher MAY delete + re-INSERT as `started`). Platform-wide partial UNIQUE index on `automation_logs` is filed as a separate follow-up spec.

**Rationale**: SC-006 promises "retry-safe under the idempotency key". A terminal-`failed` design silently breaks that guarantee: a transient n8n outage permanently drops the notification. Cross-cutting concern — `automation_logs` is shared across 018/021/022/023, so a schema change affects every consumer's retry semantics. Spec-local delete-and-retry avoids the cross-spec blast radius while honoring the retry-safe guarantee.

**Alternatives**:
- Terminal `failed` + manual reconciliation — contradicts SC-006, rejected.
- Partial UNIQUE index `WHERE status <> 'failed'` platform-wide in spec 023 — too high a blast radius for a single spec; needs its own audit + migration. Filed as follow-up.
- Composite key `(idempotency_key, attempt_number)` — heavier schema; multiple `failed` rows per key complicate reporting. Rejected.

### R-006.2 — Versioned month-close merge (CHK024)

**Decision**: `monthly_reports` adds `version integer NOT NULL DEFAULT 1` + composite UNIQUE `(student_id, period_year, period_month, version)`. Corrections append `version = MAX(version)+1`; reads select MAX(version).

**Rationale**: AGENTS.md §4 "progress is merged, never overwritten" applies to data the user has seen — a corrected report arriving after a later one must not silently lose the audit trail. Versioned append preserves history while making the latest correction canonical.

**Alternatives**:
- True append-only with no version column — duplicate reads; needs a "latest" query anyway. Effectively the same but with a less explicit contract.
- Update-in-place with no audit — violates "merged never overwritten". Rejected.
- Last-write-wins by event timestamp — silently loses corrections if clocks drift or events arrive out of order. Rejected.

### R-006.3 — Expiry lead time default 7 days (CHK015)

**Decision**: Default 7 days before period end, admin-configurable via `platform_settings.subscription_expiring_lead_days`.

**Rationale**: 7 days is the industry-standard renewal reminder window — gives the guardian time to fix a failed payment or reactivate before access is suspended. Configurable per deployment because some markets/sizes may want shorter (3d) or longer (14d).

**Alternatives**:
- 3 days — too tight if the guardian misses the email/WhatsApp; risks suspension despite intent to renew.
- 1 day — only works as a SECOND reminder, not a first.
- No default (must be set at deploy) — pushes a config decision onto every deployment; bad defaults beat no defaults.

### R-006.4 — `milestone_key` composite UNIQUE (CHK047)

**Decision**: Composite UNIQUE `(student_id, certificate_type, milestone_key)` with plain per-type values (juz=`1..30`, level=level-id, course=course-id). `certificate_type` disambiguates.

**Rationale**: Schema enforces disambiguation. No string parsing (`juz:1` vs `level:1`) needed. Matches the existing `uix_certificates_student_milestone` in data-model §2c — no schema change, only spec-text clarification.

**Alternatives**:
- Prefixed string `juz:1` / `level:abc` / `course:xyz` — works but requires every read to parse; loses type-safety.
- UUID per issuance — defeats idempotency (same milestone would generate a new UUID each time).

### R-006.5 — Distinct `notif:` prefix for delivery (CHK048)

**Decision**: `monthly_report_ready` → `notif:{guardianId}:monthly_report_ready:{reportId}`; `certificate_earned` → `notif:{recipientId}:certificate_earned:{certId}`. Issuance keys stay `report:`/`cert:`. Distinct.

**Rationale**: Issuance and delivery can fail independently. Sharing a key creates a false cross-dependency: a successful issuance + failed notification would block retry of either (lock held by issuance). Distinct keys let each retry independently.

**Alternatives**:
- Reuse `report:`/`cert:` for both — couples issuance to delivery; rejects the retry-safe guarantee when one half fails.
- Hybrid (`cert:{...}:notif`) — same coupling problem in a different shape.

