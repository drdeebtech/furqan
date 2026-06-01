# Contract — Capture interface (010)

## Domain function (Progress domain)

`src/lib/domains/progress/capture.ts`

```ts
import "server-only";
// Authenticated structured input — the route adapter has already verified
// requireRole("teacher") AND that the teacher owns the booking.
export interface RecordProgressInput {
  bookingId: string;
  progressType: "new" | "muraja" | "correction";
  range: { surahFrom: number; ayahFrom: number; surahTo: number; ayahTo: number } | null; // null only for pure 'muraja' notes
  pagesReviewed?: number | null;
  qualityRating?: number | null;   // 1..5
  level?: "beginner" | "intermediate" | "advanced";
  teacherNotes?: string | null;
  errors?: Array<{ surahNum: number; ayahNum: number; errorType: ErrorType; note?: string | null }>;
}
export type ErrorType = "makharij" | "sifat" | "madd" | "waqf" | "ghunna" | "other";

export type RecordProgressOutcome =
  | { ok: true; progressId: string }
  | { ok: false; reason: "invalid_range"; message: string }   // Arabic, names the surah + its count
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "error"; message: string };

export async function recordProgress(admin: AdminClient, input: RecordProgressInput): Promise<RecordProgressOutcome>;
```

- Validates `range` via `validation.ts` (`AYAH_COUNTS`) BEFORE the RPC → returns `invalid_range` with an Arabic message (FR-004).
- On valid input calls `rpc("record_student_progress" as never, {...})`; maps DB `23514` (range/CHECK) → `invalid_range`, `P0001 booking_not_found` → `not_found`.
- `progressType='new'` MUST carry a non-null `range` (a memorized portion); `muraja`/`correction` MAY omit it.

## Pure validation

`src/lib/domains/progress/validation.ts`

```ts
// Returns null when valid, else a domain RangeError describing the first violation.
export function validateRange(r: {surahFrom:number;ayahFrom:number;surahTo:number;ayahTo:number}):
  | null
  | { surah: number; ayahCount: number; field: "ayahFrom" | "ayahTo" | "order" };
```

Pure, table-free (uses `AYAH_COUNTS`) → unit-tested directly (interface = test surface).

## Route adapter

`src/app/teacher/sessions/[id]/actions.ts` — `recordSessionProgress`

```ts
export const recordSessionProgress = loudAction<RecordProgressFormInput, { message: string }>({
  name: "teacher.session.record-progress",
  severity: "info",
  audit: { table: "student_progress", recordId: i => i.bookingId, action: "UPSERT" },
  preflight: /* getUser */,
  handler: async (input, { actorId }) => {
    // verify teacher owns the booking (Principle IV), parse FormData → RecordProgressInput,
    // call recordProgress(admin, …), map outcome to ActionFeedback, revalidatePath,
    // then best-effort emitEvent("progress.recorded", …)
  },
});
```

Form renders `<ActionFeedback state={…} />` (FR-007). Arabic-first labels; surah via Arabic dropdown of the 114 (`SURAHS` from `src/lib/quran/surahs.ts`); āyah inputs bounded by `AYAH_COUNTS[surah]`.

## Acceptance ↔ test map

| Acceptance (spec) | Test |
|---|---|
| US1-2 impossible range rejected | `validation.test.ts` (unit) + local-PG trigger test |
| US1-4 atomic progress+errors | local-PG: force error-insert failure → progress not committed |
| US1-3 re-capture upserts | local-PG: two calls, one row |
| US3-1 trigger guards manual SQL | local-PG: raw insert of bad range → raises |
| US3-2 surah required (non-sentinel) | local-PG: CHECK rejects |
| mirror parity | `ayah-counts` vs seed snapshot (unit) |
