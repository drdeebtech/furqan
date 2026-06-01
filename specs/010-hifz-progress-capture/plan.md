# Implementation Plan: Ḥifẓ Progress Capture (تسجيل الحفظ)

**Branch**: `010-hifz-progress-capture` | **Date**: 2026-06-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-hifz-progress-capture/spec.md`

## Summary

Wire the unwired: give the teacher a fast post-session form that writes a **validated** sūrah:āyah `student_progress` row (the SM-2 scheduler in `001` reads these and today gets none). The core technical bet is **defense-in-depth validation against a canonical 114-sūrah āyah-count reference** so an Islamically-impossible range (e.g. Al-Fātiḥah āyah 300) is unrepresentable by *any* writer, plus an **atomic** progress+errors write via a Postgres function. New surface lives in the **Progress** domain; the route adapter is a thin auth/parse boundary.

## Technical Context

**Language/Version**: TypeScript 5.x, React 19 / Next.js (App Router, "use server" actions), Node 24.x
**Primary Dependencies**: Supabase (Postgres + RLS), Zod (action-layer validation), `loudAction` + `<ActionFeedback>` (Principle II), `emitEvent` (Automation)
**Storage**: Postgres — existing `student_progress`, `recitation_errors`; new `quran_surahs` reference table; new `record_student_progress()` function + `student_progress` BEFORE trigger
**Testing**: vitest (unit: validation, the TS↔DB mirror parity, the domain function shape via mocks); local-Postgres harness (the trigger + atomic function, same method used for #346/#363/#365/#366); Playwright e2e is existing suite
**Target Platform**: Vercel (web, furqan.today); Supabase hosted (prod) / self-hosted VPS (staging)
**Project Type**: Web application (Next.js full-stack, single repo)
**Performance Goals**: capture submit P95 < 300ms; validation is in-process + one `quran_surahs` PK lookup; teacher completes capture in ≤ 20s / ≤ 5 interactions (SC-002)
**Constraints**: Arabic-first UI; no per-render writes; no admin bulk fan-out; forward-migration-only (`./scripts/new-migration.sh`)
**Scale/Scope**: 50,000 DAU target. Capture is one write per session (not per render) — at 50k × ~1 session/day ≈ 50k progress writes/day, each with a 114-row PK lookup. No write amplification, no fan-out.

## Constitution Check

*GATE: passed. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| **I — Domain Ownership** | Capture lives in `src/lib/domains/progress/`; route adapter is a thin boundary; `student_progress`/`recitation_errors`/`quran_surahs` owned by Progress. | ✅ PASS |
| **II — Loud Failures** | Capture action wrapped in `loudAction`; form renders `<ActionFeedback>`; validation errors are surfaced (Arabic), never swallowed; atomic write means no partial-success silent state. | ✅ PASS |
| **III — Atomic Critical Paths** | Progress row + N error rows commit atomically via `record_student_progress()` Postgres function (mirrors `confirm_booking_with_session`). `emitEvent("progress.recorded")` is best-effort post-commit. | ✅ PASS |
| **IV — Auth at the Boundary** | Route adapter `requireRole("teacher")` + verifies teacher owns the session's booking; domain fn takes authenticated structured input. | ✅ PASS |
| **V — Tracer-Bullet Adoption** | Greenfield capture (no v0 to retire) — a true tracer-bullet vertical slice (one teacher → one validated row → student read). Unblocks `001`. | ✅ PASS |
| **50k scale (NON-NEGOTIABLE)** | One write/session, no per-render column updates, no retroactive bulk admin action, PK lookup on a 114-row table. Hot-path read (`/student/progress`) is unchanged. | ✅ PASS |
| **Bilingual UX** | All capture/error text Arabic-first; sūrah names from `name_ar`. | ✅ PASS |
| **Migration discipline** | `quran_surahs` + seed, trigger, CHECK, function ship via `./scripts/new-migration.sh`; CI `supabase db push` is source of truth. | ✅ PASS |
| **Branch hygiene (NON-NEGOTIABLE)** | Single feature branch `010-hifz-progress-capture`; spec→plan→tasks→implement; same-day draft PR. | ✅ PASS |

**No violations.** Complexity Tracking section below is empty.

### Three-lens design notes (this feature's reason to exist)
- **Lens 2 (Qurʾān accuracy)** is the load-bearing constraint here — FR-002 is NON-NEGOTIABLE. The `quran_surahs.ayah_count` seed MUST be the exact Ḥafṣ/Madanī muṣḥaf counts; a single wrong count is an Islamic-accuracy defect. The seed migration carries a comment citing the standard, and a unit test cross-checks the TS mirror against the seed.
- **Lens 3 (retention)** is served indirectly: clean structured capture is what makes `001`'s spaced review possible. The form must be fast/forgiving (SC-002) so teachers actually use it.

## Project Structure

### Documentation (this feature)

```text
specs/010-hifz-progress-capture/
├── spec.md          # /speckit.specify (done)
├── plan.md          # this file (/speckit.plan)
├── research.md      # Phase 0 — decisions & alternatives (this command)
├── data-model.md    # Phase 1 — tables, trigger, function, event (this command)
├── contracts/
│   └── record-student-progress.md   # the domain fn + action contract
└── tasks.md         # /speckit.tasks (next)
```

### Source Code (repository root)

```text
supabase/migrations/
├── <ts>_create_quran_surahs_reference.sql      # table + 114-row Hafs seed + PK
├── <ts>_student_progress_ayah_range_guard.sql  # BEFORE INSERT/UPDATE trigger + cheap CHECKs
├── <ts>_recitation_errors_require_surah.sql     # CHECK: surah_num NOT NULL unless sentinel
└── <ts>_record_student_progress_fn.sql          # atomic progress + errors function

src/lib/quran/
├── surahs.ts            # existing (names) — unchanged
└── ayah-counts.ts       # NEW — TS mirror of quran_surahs.ayah_count (114 fixed)

src/lib/domains/progress/           # NEW domain folder (Principle I)
├── capture.ts           # recordProgress() — structured input → record_student_progress() RPC
├── validation.ts        # pure isValidRange(surahFrom, ayahFrom, surahTo, ayahTo): RangeError | null
├── types.ts             # RecordProgressInput/Result + error classes
├── capture.test.ts      # unit: action shape + outcome mapping
└── validation.test.ts   # unit: range validation incl. impossible-range cases + mirror parity

src/app/teacher/sessions/[id]/
├── actions.ts           # + recordSessionProgress route adapter (requireRole, owns-booking, loudAction)
├── post-session-form.tsx# extend: surah:ayah range inputs (Arabic surah dropdown) + errors
└── page.tsx             # render the captured range (already reads it)

src/lib/automation/emit.ts          # + "progress.recorded" key in WEBHOOK_ROUTES
src/app/student/progress/*          # empty-state polish only (reads real data now)
```

**Structure Decision**: Web-app single-repo. The feature creates the **Progress domain folder** (`src/lib/domains/progress/`) — the third domain folder after `booking` and `session` (`package` exists from PR #365). This continues the ADR-0002/0004 pattern. The route adapter at `teacher/sessions/[id]/actions.ts` stays the auth/FormData boundary; all capture logic + validation moves into the domain.

## Complexity Tracking

> No constitution violations. Nothing to justify.
