# Implementation Plan: Database Types Drift Guard

**Branch**: `026-database-types-drift-guard` | **Date**: 2026-06-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/026-database-types-drift-guard/spec.md`

---

## Summary

Make the `src/types/database.ts` maintenance workflow reliable without collapsing it into `src/types/supabase.generated.ts`. The spike documented in the spec proved that `database.ts` is a hand-corrected type layer, not a stale duplicate. This plan implements the low-risk path: document the hand corrections in the file, add a repeatable regenerate-and-repatch runbook, and add a lightweight reminder when schema migrations change without touching the corrected layer.

The higher-risk overlay refactor remains explicitly out of scope for this pass.

## Technical Context

**Language/Version**: TypeScript strict, Node 24, Next.js App Router  
**Primary Dependencies**: Supabase CLI type generation, existing `src/types/database.ts`, existing `src/types/supabase.generated.ts`  
**Storage**: PostgreSQL/Supabase schema types only; no runtime schema migration in this feature  
**Testing**: `npx tsc --noEmit`, `npm run test:unit`; optional focused test of `src/lib/supabase/rpc.test.ts` if type signatures move  
**Target Platform**: Developer workflow and CI on this repository  
**Project Type**: Tooling/documentation guard for a web application  
**Performance Goals**: N/A for runtime; typecheck remains the enforcement point  
**Constraints**: Do not blind-regenerate or collapse `src/types/database.ts`; preserve nullable RPC argument corrections and hand-authored TEXT-CHECK unions; no `any`; no implementation changes to Quran/progress behavior  
**Scale/Scope**: 96 importers of `src/types/database.ts`; all future migrations that alter generated types

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| Domain Ownership | PASS | Tooling-only change; no domain writes or new owner-domain. |
| Loud Failures | PASS | No mutating server actions. Any future script must fail loudly and exit non-zero on drift. |
| Atomic Critical Paths | PASS | No runtime critical path or database writes. |
| Auth at the Boundary | PASS | No auth/session code. |
| Tracer-Bullet Adoption | PASS | This is a contained tooling feature with an explicit spec/plan/tasks path. |
| 50,000-user scale target | PASS | No runtime fan-out; protects type correctness for progress/dashboard paths at scale. |
| Branch Hygiene | PASS | Branch is `026-database-types-drift-guard`; first tasks must include draft PR/tracking issue before implementation work. |

## Project Structure

### Documentation (this feature)

```text
specs/026-database-types-drift-guard/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md
```

### Source Code (repository root)

```text
src/types/
├── database.ts                 # hand-corrected layer; add correction inventory
└── supabase.generated.ts       # raw generated output; unchanged by this plan

scripts/
└── regen-database-types.md     # runbook for regenerate-and-repatch workflow

.github/workflows/
└── db-types-fresh.yml          # existing raw generated type freshness guard; referenced, not replaced
```

**Structure Decision**: Use the existing type files and scripts/docs locations. Do not introduce a new package, codegen tool, or overlay abstraction in this feature.

## Phase 0: Research

Research confirms the existing spike result:

- `database.ts` contains real corrections over raw generated types.
- Raw re-export/collapse loses nullability corrections and breaks core progress/RPC code.
- A hard raw diff in CI is not viable because corrected and generated files intentionally differ.

Output: [research.md](research.md)

## Phase 1: Design

Design artifacts:

- [data-model.md](data-model.md): Defines the corrected type layer, raw generated layer, correction inventory, and regen workflow entities.
- [quickstart.md](quickstart.md): Documents the operator workflow for safe regen/repatch validation.
- No API contracts are required; this feature has no runtime endpoint or external interface.

## Implementation Approach

1. Add a top-of-file correction inventory to `src/types/database.ts`.
2. Add a short regen/repatch runbook under `scripts/`.
3. Add a documented migration drift reminder as MVP; a lightweight automated guard is optional if it stays narrower than a hard raw-codegen diff.
4. Verify with `npx tsc --noEmit` and `npm run test:unit`.

## Deferred Work

The overlay refactor remains a separate future feature. It needs a typed RPC wrapper or mapped-type function overlay design before any attempt to delete the embedded corrected copy.

## Complexity Tracking

No constitution violations or justified complexity exceptions.
