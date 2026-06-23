# Data Model: Database Types Drift Guard

This feature has no runtime database tables. The "model" is the developer workflow around generated and corrected type artifacts.

## Entities

### Raw Generated Database Types

- **File**: `src/types/supabase.generated.ts`
- **Source**: `npm run db:types`
- **Purpose**: Raw Supabase codegen output.
- **Constraint**: Do not hand-edit.

### Corrected Database Types

- **File**: `src/types/database.ts`
- **Source**: Hand-corrected layer over generated schema knowledge.
- **Purpose**: Stable domain-facing aliases and corrected database type signatures.
- **Known correction classes**:
  - Nullable RPC args for functions with `DEFAULT NULL`.
  - `Course` row corrections.
  - Ijazah and mentorship TEXT-CHECK union refinements.
  - TEXT-CHECK enum unions not represented as Postgres enums.

### Correction Inventory

- **Location**: Top-of-file comment in `src/types/database.ts`.
- **Purpose**: Gives future regenerators a checklist of intentional deviations from raw codegen.
- **Validation**: Typecheck and unit tests after applying corrections.

### Regen/Repatch Runbook

- **Location**: `scripts/regen-database-types.md`.
- **Purpose**: Documents the safe sequence for updating generated types and preserving corrections.
- **Validation**: `npx tsc --noEmit` and `npm run test:unit`.

## Relationships

- Raw generated types feed comparison and review.
- Corrected database types are imported by application code.
- Correction inventory explains why corrected database types differ from raw generated types.
- Runbook controls updates when migrations alter schema shape.
