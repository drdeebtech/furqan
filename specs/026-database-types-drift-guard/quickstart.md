# Quickstart: Database Types Drift Guard

## Goal

Safely update database type definitions without losing known corrections in `src/types/database.ts`.

## Safe Workflow

1. Regenerate raw Supabase types:

   ```bash
   npm run db:types
   ```

2. Review schema-related changes against `src/types/database.ts`.

3. Re-apply or update the correction inventory in `src/types/database.ts`.

4. Run verification:

   ```bash
   npx tsc --noEmit
   npm run test:unit
   ```

5. If type errors appear in progress capture or RPC tests, inspect whether a known correction was lost before changing application code.

## Do Not

- Do not replace `database.ts` with a direct re-export of `supabase.generated.ts`.
- Do not remove nullable RPC argument corrections just because codegen emits non-null values.
- Do not use `any` to bypass corrected type drift.
- Do not regenerate `database.ts` blindly.
