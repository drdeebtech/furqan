# Implementation Plan: Reports, Gamification & Notifications

**Branch**: `023-reports-gamification-notifications` | **Date**: 2026-06-16 (revised 2026-06-19) | **Spec**: [spec.md](spec.md)
**Tracking issue**: [#489](https://github.com/drdeebtech/furqan/issues/489) | **Draft PR**: [#490](https://github.com/drdeebtech/furqan/pull/490) (constitution §branch-hygiene: opened same-day)
**Input**: Feature specification from `specs/023-reports-gamification-notifications/spec.md`

---

## Summary

Build the human-visible layer on top of events emitted by earlier phases: teacher notes + monthly level-assessment reports (guardian-scoped), simple appreciation and course-completion certificates (in-app shareable cards, NOT ijazah) citing Quran ranges exclusively from `src/lib/quran/`, lightweight gamification via an honor board with opt-out, and idempotent notification content + delivery on in-app/email/WhatsApp via n8n. Extends the existing `notifications` table with a WhatsApp channel; adds 4 new tables (teacher_notes, monthly_reports, certificates, honor_board_entries); all system-generated artifacts are service-role writes with RLS enforcing family-scoped reads.

---

## Technical Context

**Language/Version**: TypeScript 5 strict, Node 24, Next.js App Router
**Primary Dependencies**: Supabase JS v2, n8n (via existing webhook intake), Zod v3, `src/lib/automation/emit.ts` (emitEvent), `src/lib/quran/ayah-counts.ts`
**Storage**: PostgreSQL 15 via Supabase; migrations in `supabase/migrations/` after baseline
**Testing**: Vitest (unit); Quran-range unit test mandatory (no hardcoded counts)
**Constraints**: RLS every new table; service-role-only writes for artifacts; `(select auth.uid())` initplan; BEFORE UPDATE OF guards on identity/achievement columns; FurqanEvent enum (no string literals); n8n failures → `failed` never `succeeded`
**Existing infrastructure reused**: `automation_logs` (idempotency_key UNIQUE), `emitEvent`, n8n intake at `src/app/api/webhooks/n8n/route.ts`, `src/lib/security/secrets.ts` (`safeCompareSecret`)

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| RLS on every new table, policies in same migration | ✅ PASS | 4 new tables: teacher_notes, monthly_reports, certificates, honor_board_entries |
| Service-role key server-only | ✅ PASS | All artifact writes are service-role; reads are RLS-scoped |
| `userId` from auth session, never request input | ✅ PASS | Student identity resolved from `auth.getUser()` |
| Zod validation at every route handler | ✅ PASS | All inputs validated at route boundary |
| Quran ranges from canonical source only | ✅ PASS | `src/lib/quran/ayah-counts.ts` — never generated/hardcoded |
| Certificates are appreciation only — NOT ijazah/sanad | ✅ PASS | FR-008 explicit |
| Typed event names (FurqanEvent enum) — no string literals | ✅ PASS | AGENTS.md §4 |
| BEFORE UPDATE OF guards on identity/achievement columns | ✅ PASS | certificates, monthly_reports immutable after insert |
| n8n failure → `failed` not `succeeded` | ✅ PASS | FR-015 |
| Email headers: strip CR/LF from user-authored values | ✅ PASS | FR-016 |
| `npm run db:types` + tsc + lint pass | ✅ GATE | Required before PR merge |
| `sb:advisors` clean for new tables | ✅ GATE | Required |
| Quran-range unit test (no hardcoded counts) | ✅ GATE | NFR-003 |

---

## Project Structure

### Source Code Layout

```text
src/
├── app/api/
│   ├── reports/
│   │   └── [studentId]/
│   │       ├── notes/route.ts              ← GET + POST teacher notes
│   │       └── monthly/[year]/[month]/route.ts  ← GET monthly report
│   ├── certificates/
│   │   └── [studentId]/route.ts            ← GET certificates
│   └── honor-board/
│       ├── route.ts                        ← GET public honor board
│       └── opt-out/route.ts               ← PATCH opt-out
└── lib/domains/
    ├── reports/
    │   ├── notes.ts                        ← teacher notes CRUD
    │   └── monthly-report.ts              ← generate monthly report
    ├── certificates/
    │   ├── issue.ts                        ← idempotent issuance via automation_logs
    │   └── quran-ranges.ts               ← boundary lookup from src/lib/quran/
    ├── honor-board/
    │   └── compute.ts                     ← ranking + opt-out query
    └── notifications/
        └── routing.ts                     ← event→channel routing handlers

supabase/migrations/
├── 20260620000000_notifications_whatsapp_channel.sql
│   — extends notifications.channel CHECK to include 'whatsapp'
└── 20260620000001_reports_certificates.sql
    — CREATE teacher_notes, monthly_reports (UNIQUE student+period),
      certificates (UNIQUE student+type+milestone_key, immutable),
      honor_board_entries (is_opted_out, display-safe cols)
    — RLS all 4 tables; BEFORE UPDATE guards; set_updated_at triggers
    — INSERT platform_settings: honor_board_refresh_cadence_days='7',
      notifications_whatsapp_enabled='true', notification_channel_matrix (FR-012)
```

---

## Key Implementation Decisions

1. **Idempotency**: All artifact issuance (certificates, monthly reports, notifications) gated via `automation_logs.idempotency_key UNIQUE`. Key format: `cert:{student_id}:{type}:{milestone_key}` / `report:{student_id}:{year}:{month}` / `notif:{recipientId}:{trigger}:{subjectKey}` (recipient-first, per FR-014). ON CONFLICT → `status='skipped'`, no duplicate created.

2. **WhatsApp channel**: Extend `notifications.channel` CHECK constraint (drop + re-add); existing rows unaffected. WhatsApp dispatch via existing n8n intake — no new endpoint, no new Stripe-style secret registration.

2b. **Per-trigger channel routing**: each trigger resolves its `notifications.channel[]` from `platform_settings.notification_channel_matrix` (FR-012 matrix; default seed in data-model §3), never hardcoded; `whatsapp` is dropped from the resolved set when `notifications_whatsapp_enabled='false'`. Makes SC-005 testable (assert resolved `channel[]` == matrix per trigger).

3. **Quran ranges**: `src/lib/quran/ayah-counts.ts` is the only source for any `surah:ayah` or juz boundary on a certificate. `getJuzBoundaries(juzNumber)` throws on invalid juz — propagated as 422. Unit test asserts zero hardcoded counts in certificate domain code.

4. **Honor board privacy**: `is_opted_out boolean DEFAULT false`. SELECT query filters `WHERE is_opted_out = false`. Only display-safe columns in SELECT (`display_name`, `avatar_url`, `achievement_metric`, `rank_period`). Guardian opt-out for minors validated via `guardian_children` join. ⛔ **`achievement_metric` ranking formula is [NEEDS CLARIFICATION] (FR-010) and blocks T023 — P2/US4 only; privacy/opt-out (SC-008) is unaffected.**

5. **n8n event routing** *(round-2 clarification 2026-06-19: pragmatic ownership split)*: 
   - **Owned + emitted by spec 023** (`FurqanEvent` enum entries added in T001): `monthly_report.ready`, `certificate.earned`, `honor_board.updated`.
   - **Consumed from spec 018** (already emitted, no new work): `subscription.past_due` — routed to dunning / payment-failed notifications.
   - **Emitted locally by spec 023** (no upstream emitter exists as of 2026-06-19): `subscription.expiring` (nightly cron reads `subscriptions.current_period_end - lead_days` and emits per due row) and `absence.outcome` (scheduled job queries `attendance` for new absence/excuse outcomes). Specs 018/021 may later take over emission; the dot.notation names already match so no rename is needed when they do.
   - All routed via existing `emitEvent()`. Delivery failures → `automation_logs.status = 'failed'` (column name canonical per round-2: `workflow_name`, `event_name`, `payload_json`, `result_json`, `error_message`), Sentry-surfaced, never `'succeeded'`.

6. **Certificates are appreciation only**: The system MUST NOT represent any certificate as ijazah or implement isnād/sanad chains. `certificate_type` enum contains only `appreciation_juz`, `appreciation_level`, `course_completion`. No ijazah fields on the table.

7. **Honor board refresh sizing @ 50k** *(resolved 2026-06-19, /speckit-analyze C1/C4)*: a single refresh recomputes `honor_board_entries` for every active student — ~50k rows at the constitution scale target (CLAUDE.md §"Scale Target Rule"). The naive "INSERT one row per student per refresh" pattern is an **unbounded bulk INSERT** at that scale. The implementation MUST:
   - **Single-statement `INSERT … SELECT … FROM profiles WHERE is_active AND deleted_at IS NULL`** with the metric computed inline — one round-trip, no N+1, no client-side loop. A 50k-row INSERT in a single statement runs in seconds on Postgres with appropriate indexes.
   - **Period-replace semantics**: `BEGIN; DELETE FROM honor_board_entries WHERE rank_period = :period; INSERT … SELECT …; COMMIT;` — bounded by rows-for-period (≤ 50k), transactional, no orphaned partial states.
   - **Runtime budget**: a refresh is a background job (not a request). Cap wall-clock at 30s via `statement_timeout = '30s'` on the worker connection; if it times out, the previous period's rows remain (DELETE hasn't committed) and Sentry surfaces the timeout.
   - **Cadence**: `honor_board_refresh_cadence_days` (default 7) gates how often the job fires; not a per-render write.
   - **No per-page-render write amplification**: honor board reads are SELECTs against the precomputed snapshot; no `computed_at` UPDATE on view.

   This resolves constitution §50k CRITICAL flags: "nightly cron whose worst-case fan-out is unsized at 50k × per-user-row-count" (now sized — single-statement, ≤50k rows, 30s budget) and "admin action that performs an unbounded UPDATE / DELETE / INSERT" (now bounded — DELETE is period-scoped, INSERT is one statement).

---

## Artifacts

| File | Status |
|------|--------|
| research.md | ✅ Complete (+ R-006 2026-06-19 decisions appended) |
| data-model.md | ✅ Complete (+ §6 revisions 2026-06-19 appended; `monthly_reports.version` + composite UNIQUE added) |
| contracts/api.md | ✅ Complete (+ §8 note on issuance/delivery key independence appended) |
| quickstart.md | ✅ Complete |
| tasks.md | ⏳ Next (regenerate via `/speckit-tasks` to reflect the 5 clarifications) |

---

## Plan Revisions — Session 2026-06-19 (post-clarify)

Five clarifications from the 2026-06-19 `/speckit-clarify` pass; plan impact below. Spec §Clarifications "Session 2026-06-19" is the source of truth.

| # | Topic | Plan impact |
|---|-------|-------------|
| Q1 | Retry vs idempotency lock (CHK032) | **Cross-cutting.** Spec 023 ships a **spec-local delete-and-retry** on `failed` rows (no platform schema change). A platform-wide partial UNIQUE index on `automation_logs` is filed as a **separate follow-up spec** — do NOT bundle into 023. See data-model §6.2. |
| Q2 | Out-of-order month-close merge (CHK024) | `monthly_reports` schema updated: added `version` column + composite UNIQUE `(student_id, period_year, period_month, version)`. Reader contract `ORDER BY version DESC LIMIT 1`. Tasks that generate or read monthly reports (T012, T013, monthly-report domain code) must follow this. |
| Q3 | Expiry lead time (CHK015) | `platform_settings.subscription_expiring_lead_days` (integer, default 7) added to the seed block. The dispatcher reads it via `getSetting` (no hardcoding). SC-005 asserts delivery at exactly `period_end - N days`. |
| Q4 | `milestone_key` format (CHK047) | No change — the existing `uix_certificates_student_milestone (student_id, certificate_type, milestone_key)` IS the correct composite. Spec text clarified; schema unchanged. |
| Q5 | `notif:` vs `report:`/`cert:` independence (CHK048) | No change — contracts §7 already uses distinct prefixes (issuance `report:`/`cert:`, delivery `notif:`). Spec text clarified. |

### ⛔ Outstanding (deferred, not blockers)

- **FR-010 honor-board achievement metric** — `[NEEDS CLARIFICATION]` pending product-owner input. Blocks task T023 and the ranking half of SC-008. Confined to P2/US4 — does NOT affect any P1 story.
- **CHK006 WhatsApp provider/templates** — pending n8n-owner input.
- **CHK001/CHK042 month-close emitter** — cross-spec dependency on spec 018 emitting `subscription.month_closed` (or equivalent). Currently no emitter; blocks the FR-002 user story until spec 018 ships one. Flagged in FR-002.

`/speckit-tasks` can proceed against the resolved items; the deferred items remain tagged in the spec for the product owner and will produce ⛔ markers in `tasks.md`.
