# 013 — Progress / follow-up action hardening (MEDIUM audit items)

**Feature Branch**: `refactor/follow-up-collapse` *(spec 013's work shipped via PR #458 alongside specs 011/012/015/016/017; all 7 tasks marked complete in tasks.md with per-task completion notes)*
**Status:** Shipped via [#458](https://github.com/drdeebtech/furqan/pull/458) (refactor/follow-up-collapse) — verified 2026-06-18.
**Date:** 2026-06-13 · **Source:** `specs/audit-progress-actions.md` (MEDIUM tier, now closed)
**Lenses:** 🛠 engineer (validation/authz/UX) · 📖 Quran (range integrity) · 🎓 platform (stale-UI)

## Problem

The follow-up / ḥifẓ-progress write surface passes the three-lens audit on the HIGH items
(already shipped: surah/ayah range guard, tajweed-error passthrough) but five **MEDIUM** items
remained — boundary-validation gaps and a stale-UI bug. None was a live exploit, but each weakened
a defense-in-depth layer or degraded correctness. All M1-M5 closed via #458; this spec is the
paper-trail close-out. Verified still-fixed on 2026-06-18.

| ID | Lens | Issue | Location |
|----|------|-------|----------|
| M1 | 🛠 | `recordSessionProgressBase` has **no Zod `schema:`** — structured input reaches the domain unvalidated at the boundary | `src/app/teacher/sessions/[id]/actions.ts:205` |
| M2 | 🛠 | `gradeFollowUp` grade is `z.string() as unknown as ZodType<HomeworkStatus>` — Zod accepts **any** string; only the domain `VALID_GRADES` check guards | `src/lib/actions/follow-up.ts:254` |
| M3 | 🛠 | `editFollowUp` updates is `z.record(z.string(), z.unknown())` and the domain **spreads it unbounded** into the UPDATE → a non-form caller can set `teacher_id`/`student_id`/`status`/`audio_url`/`parent_assignment_id` | `follow-up.ts:296`, `domains/follow-up/manage.ts:99-102` |
| M4 | 📖 | Auto-regen copies parent `surah_number/ayah_start/ayah_end` **verbatim** with no app-layer validation (DB trigger now backstops, so bad data makes regen fail silently) | `domains/follow-up/actions.ts:307-320` |
| M5 | 🎓 | `revalidateFollowUpPaths()` revalidates `/teacher/**` + `/student/**` only — **admin** dashboards (`/admin/dashboard`, `/admin/follow-up`, `/admin/follow-up/grade`) show stale data after create/grade/edit/delete | `follow-up.ts:85-92` |

Plus one branch-introduced **LOW**: unused `surahName` import warning in
`src/lib/domains/progress/validation.test.ts:4` — fold into this work.

## Goals

- Validate every external input at the action boundary with Zod (M1, M2, M3) — defense in depth,
  not replacing the domain/DB guards.
- Make follow-up writes **field-whitelisted** so privileged columns can't be injected (M3).
- Keep Quran range integrity even on the auto-regen path (M4).
- Admin UI reflects follow-up mutations immediately (M5).

## Non-goals

- No schema/migration changes (these are app-layer; the DB guards already exist).
- No behavior change to valid happy-path flows — only reject/​strip invalid input and add admin revalidation.

## Acceptance

- `recordSessionProgress` rejects malformed input (bad `progressType`, non-integer ayah, out-of-range
  `qualityRating`) at the Zod layer before the domain runs.
- `gradeFollowUp` rejects any grade outside the 4 valid statuses at the Zod layer.
- `editFollowUp` **strips/rejects** any field outside the editable whitelist at both the action Zod
  and the domain write; injecting `status`/`teacher_id` cannot change the row.
- Auto-regen validates the inherited range; invalid → range omitted + logged, regen still succeeds.
- Admin follow-up/dashboard paths revalidate after every follow-up mutation.
- `npx tsc --noEmit` clean; `npm run test:unit` green; new unit tests cover M2/M3 rejection + M3 strip.
