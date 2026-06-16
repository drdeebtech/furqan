# Implementation Plan: Reports, Gamification & Notifications

**Branch**: `023-reports-gamification-notifications` | **Date**: 2026-06-16 | **Spec**: [spec.md](spec.md)
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
    — INSERT platform_settings: honor_board_refresh_cadence_days='7'
```

---

## Key Implementation Decisions

1. **Idempotency**: All artifact issuance (certificates, monthly reports, notifications) gated via `automation_logs.idempotency_key UNIQUE`. Key format: `cert:{student_id}:{type}:{milestone_key}` / `report:{student_id}:{year}:{month}` / `notif:{recipient_id}:{trigger}:{subject_id}`. ON CONFLICT → `status='skipped'`, no duplicate created.

2. **WhatsApp channel**: Extend `notifications.channel` CHECK constraint (drop + re-add); existing rows unaffected. WhatsApp dispatch via existing n8n intake — no new endpoint, no new Stripe-style secret registration.

3. **Quran ranges**: `src/lib/quran/ayah-counts.ts` is the only source for any `surah:ayah` or juz boundary on a certificate. `getJuzBoundaries(juzNumber)` throws on invalid juz — propagated as 422. Unit test asserts zero hardcoded counts in certificate domain code.

4. **Honor board privacy**: `is_opted_out boolean DEFAULT false`. SELECT query filters `WHERE is_opted_out = false`. Only display-safe columns in SELECT (`display_name`, `avatar_url`, `achievement_metric`, `rank_period`). Guardian opt-out for minors validated via `guardian_children` join.

5. **n8n event routing**: New `FurqanEvent` enum entries: `MonthlyReportReady`, `CertificateEarned`, `HonorBoardUpdated`. Consumed events: `PaymentFailed`, `SubscriptionExpiring`, `AbsenceOutcome`. All routed via existing `emitEvent()`. Delivery failures → `automation_logs.status = 'failed'`, Sentry-surfaced, never `'succeeded'`.

6. **Certificates are appreciation only**: The system MUST NOT represent any certificate as ijazah or implement isnād/sanad chains. `certificate_type` enum contains only `appreciation_juz`, `appreciation_level`, `course_completion`. No ijazah fields on the table.

---

## Artifacts

| File | Status |
|------|--------|
| research.md | ✅ Complete |
| data-model.md | ✅ Complete |
| contracts/api.md | ✅ Complete |
| quickstart.md | ✅ Complete |
| tasks.md | ⏳ Next |
