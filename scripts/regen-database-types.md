# Regenerating `src/types/database.ts` safely

`src/types/database.ts` is a **hand-corrected layer**, not a generated file.
`npm run db:types` regenerates **only** `src/types/supabase.generated.ts`. The
corrected `database.ts` must be updated by hand using the checklist below.

> **Never** replace `database.ts` with `import type { Database } from "./supabase.generated"`,
> never blind-regen it, never use `any`. A 2026-06-21 spike proved the collapse drops
> corrections → 12 tsc errors in `progress/capture.ts` + `rpc.test.ts`.

## When to run this

Any migration that adds/renames/retypes a column, RPC arg, or TEXT-CHECK constraint
consumed through a `database.ts` alias.

## Steps

1. **Regenerate the raw types** (writes the generated file only):
   ```bash
   npm run db:types          # supabase gen types typescript --linked > src/types/supabase.generated.ts
   ```

2. **Re-apply the correction inventory** to `src/types/database.ts`. Diff the relevant
   rows/functions against the freshly generated file and re-patch each correction:
   - **Nullable RPC args** (DEFAULT NULL → `… | null`): `record_student_progress`
     (`p_surah_from`, `p_ayah_from`, `p_pages_reviewed`, `p_quality_rating`, `p_level`,
     `p_teacher_notes`) and any other RPC whose args are `DEFAULT NULL` in SQL.
   - **`Course` row**: `teacher_id` nullable; keep `ownership` and `teacher_revenue_share_bps`.
   - **Ijazah / Mentorship rows**: keep the hand-authored TEXT-CHECK unions for
     `recitation_standard`, `status`, `requirement_type`, `severity`.
   - **TEXT-CHECK enum unions** the generator can't see: `RecitationStandard`,
     `PackageType`, … (string-literal unions).

   The authoritative list lives in the header comment of `src/types/database.ts`
   (`CORRECTION INVENTORY`). Keep that comment and this checklist in sync.

3. **Verify** — both must be clean before committing:
   ```bash
   npx tsc --noEmit
   npm run test:unit
   ```

## Failure triage rule

If step 3 fails after a regen, **first inspect whether a correction was lost** —
do NOT change application code to satisfy raw generated types. The spike's 12 errors
were the *loss of corrections*, not bugs in `progress/capture.ts` or `rpc.test.ts`.
Re-apply the missing correction, then re-verify.
