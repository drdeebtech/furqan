# Research: Database Types Drift Guard

## Decision 1: Preserve `database.ts` as a Corrected Layer

**Decision**: Keep `src/types/database.ts` as the authoritative hand-corrected type layer for current importers.

**Rationale**: The previous spike proved that replacing it with a raw re-export from `supabase.generated.ts` breaks legitimate code paths, especially nullable RPC arguments used by progress capture and Supabase RPC tests.

**Alternatives considered**:

- Collapse to raw generated types: rejected because it drops known corrections and creates false type errors.
- Immediate overlay refactor: deferred because nested function argument overlays require a typed RPC design.

## Decision 2: Use a Runbook Before Automation

**Decision**: Add a documented regenerate-and-repatch workflow before introducing a hard CI gate.

**Rationale**: A raw diff cannot be the gate because corrected and generated files intentionally differ. The first useful guard is an explicit correction inventory plus a repeatable manual workflow.

**Alternatives considered**:

- Hard CI diff between generated and corrected files: rejected because it would always flag intentional corrections.
- No guard: rejected because schema changes can silently leave uncorrected aliases stale.

## Decision 3: Treat Overlay Refactor as a Separate Feature

**Decision**: Do not attempt the overlay refactor in this feature.

**Rationale**: The overlay path is attractive, but risky enough to need its own design review. It touches 96 importers and the hard part is function-argument nullability.

**Alternatives considered**:

- Patch only row aliases while leaving functions embedded: rejected for this pass because it creates a hybrid type system without reducing enough risk.
- Introduce `any` around RPC calls: rejected by TypeScript strictness and because it would hide exactly the class of drift this spec is meant to expose.
