# Data Model — Ḥifẓ Progress Capture (010)

Phase 1 output. Defines the new reference table, the validation trigger, the atomic capture function, the `recitation_errors` constraint, and the event. Spelling/values follow CONTEXT.md.

## 1. `quran_surahs` (new reference table — canonical, immutable)

```sql
create table public.quran_surahs (
  surah_num  smallint primary key check (surah_num between 1 and 114),
  name_ar    text not null,
  name_en    text not null,
  ayah_count smallint not null check (ayah_count > 0),
  juz_start  smallint            -- nullable; for a future Juzʾ phase, not surfaced in v1
);
-- Seed: exactly 114 rows, Ḥafṣ ʿan ʿĀṣim / Madanī muṣḥaf āyah numbering.
-- Al-Fātiḥah=7, Al-Baqarah=286, Āl-ʿImrān=200, … Al-Falaq=5, An-Nās=6.
-- RLS: readable by all authenticated roles (reference data); writable by service-role/migrations only.
```

- **Why a table (not only a TS array):** the FR-002 hard guard is a Postgres trigger, which needs the counts in-DB. The table is the DB source of truth.
- **Immutability:** seeded once; the counts are fixed. No app write path. A migration is the only way to change it (there is no reason to).

## 2. TS mirror — `src/lib/quran/ayah-counts.ts`

```ts
// Canonical Ḥafṣ āyah counts, surah_num → count. Mirrors quran_surahs.ayah_count.
// A unit test asserts this equals the seeded table (no drift possible in practice).
export const AYAH_COUNTS: Record<number, number> = { 1: 7, 2: 286, /* … */ 114: 6 };
```

Used by the action-layer fast validation (FR-004) and the UI āyah-bound hints. **Parity test** (FR-003): a vitest that reads `quran_surahs` (or a committed snapshot) and asserts `AYAH_COUNTS` matches.

## 3. `student_progress` — validation trigger (FR-002 hard guard)

`student_progress` is **existing**; this adds the guard. No column changes.

```sql
-- cheap in-table CHECKs (the existing valid_progress_range stays):
alter table public.student_progress
  add constraint ayah_from_positive check (ayah_from is null or ayah_from >= 1),
  add constraint ayah_to_positive   check (ayah_to   is null or ayah_to   >= 1);

-- cross-table hard guard: BEFORE INSERT OR UPDATE trigger validates against quran_surahs.
create or replace function public.validate_student_progress_range()
returns trigger language plpgsql set search_path = public as $$
declare v_from_count smallint; v_to_count smallint;
begin
  if new.surah_from is not null then
    select ayah_count into v_from_count from quran_surahs where surah_num = new.surah_from;
    if v_from_count is null then
      raise exception 'invalid surah_from %', new.surah_from using errcode='23514';
    end if;
    if new.ayah_from is not null and new.ayah_from > v_from_count then
      raise exception 'ayah_from % exceeds surah % count %', new.ayah_from, new.surah_from, v_from_count using errcode='23514';
    end if;
  end if;
  if new.surah_to is not null then
    select ayah_count into v_to_count from quran_surahs where surah_num = new.surah_to;
    if v_to_count is null then
      raise exception 'invalid surah_to %', new.surah_to using errcode='23514';
    end if;
    if new.ayah_to is not null and new.ayah_to > v_to_count then
      raise exception 'ayah_to % exceeds surah % count %', new.ayah_to, new.surah_to, v_to_count using errcode='23514';
    end if;
  end if;
  return new;
end; $$;

create trigger t_validate_student_progress_range
  before insert or update of surah_from, ayah_from, surah_to, ayah_to
  on public.student_progress
  for each row execute function validate_student_progress_range();
```

- Ordering (`surah_to ≥ surah_from`, same-sūrah `ayah_to ≥ ayah_from`) is the **existing** `valid_progress_range` CHECK — unchanged, complements this.
- The trigger guards **every** writer (app, RPC, manual SQL, future import) — User Story 3.

## 4. `record_student_progress()` — atomic capture (FR-005)

```sql
create or replace function public.record_student_progress(
  p_booking_id uuid,
  p_progress_type text,         -- 'new' | 'muraja' | 'correction'
  p_surah_from smallint, p_ayah_from smallint,
  p_surah_to smallint,   p_ayah_to smallint,
  p_pages_reviewed smallint,
  p_quality_rating smallint,
  p_level text,
  p_teacher_notes text,
  p_errors jsonb               -- [{surah_num, ayah_num, error_type, note}, …]
) returns uuid                  -- student_progress.id
language plpgsql security definer set search_path = public as $$
declare v_student uuid; v_teacher uuid; v_progress_id uuid;
begin
  -- derive parties from the booking (caller already authorized at the adapter)
  select student_id, teacher_id into v_student, v_teacher from bookings where id = p_booking_id;
  if v_student is null then raise exception 'booking_not_found' using errcode='P0001'; end if;

  insert into student_progress (student_id, teacher_id, booking_id, progress_type,
        surah_from, ayah_from, surah_to, ayah_to, pages_reviewed, quality_rating, level, teacher_notes)
  values (v_student, v_teacher, p_booking_id, p_progress_type,
        p_surah_from, p_ayah_from, p_surah_to, p_ayah_to, p_pages_reviewed, p_quality_rating,
        coalesce(p_level, 'beginner'), p_teacher_notes)
  on conflict (student_id, booking_id) do update set
        progress_type = excluded.progress_type,
        surah_from = excluded.surah_from, ayah_from = excluded.ayah_from,
        surah_to = excluded.surah_to, ayah_to = excluded.ayah_to,
        pages_reviewed = excluded.pages_reviewed, quality_rating = excluded.quality_rating,
        level = excluded.level, teacher_notes = excluded.teacher_notes
  returning id into v_progress_id;
  -- the validate_student_progress_range trigger fires here; an impossible range aborts the txn.

  -- replace errors for this progress row (idempotent re-capture)
  delete from recitation_errors where progress_id = v_progress_id and note is distinct from '__no_errors_observed_sentinel__';
  if p_errors is not null then
    insert into recitation_errors (progress_id, surah_num, ayah_num, error_type, note)
    select v_progress_id, (e->>'surah_num')::smallint, (e->>'ayah_num')::int, e->>'error_type', e->>'note'
    from jsonb_array_elements(p_errors) e;
  end if;

  return v_progress_id;
end; $$;
```

- Both writes in one function = atomic (Principle III). The range trigger validates inside the same txn, so an impossible range rolls back the whole capture.
- `security definer` + fixed `search_path` (same hardening as the package/session functions). Caller is authorized at the adapter (Principle IV).
- Registered in `src/types/database.ts` Functions; called via `rpc("record_student_progress" as never, …)` (the issue-#185 pattern).

## 5. `recitation_errors` — require surah for real errors (FR-006)

```sql
alter table public.recitation_errors
  add constraint surah_required_for_real_errors
  check (surah_num is not null or note = '__no_errors_observed_sentinel__');
-- surah_num validity (1..114) is the existing CHECK; tie-to-quran_surahs via the same trigger
-- pattern if stricter validation is wanted (v1: the 1..114 CHECK + required-ness suffices).
```

No backfill: there are currently **zero** real error rows; sentinel rows keep `surah_num` NULL.

## 6. Event (FR-010)

- New `FurqanEvent` key **`progress.recorded`** in `WEBHOOK_ROUTES` (`src/lib/automation/emit.ts`).
- Emitted best-effort post-commit from the capture domain fn's caller: `emitEvent("progress.recorded", "student_progress", v_progress_id, { student_id, teacher_id, progress_type, surah_from, surah_to })`.
- Consumers: parent reports; the `001` SM-2 nightly compute (which will key new schedule rows off fresh `progress_type='new'` rows).

## Validation matrix (the three defense layers)

| Case | Action layer (Zod + AYAH_COUNTS) | Trigger (quran_surahs) | In-table CHECK |
|------|----------------------------------|------------------------|----------------|
| Al-Fātiḥah āyah 300 | reject, Arabic msg | reject (backstop) | — |
| ayah_from = 0 | reject | — | reject (>=1) |
| surah_to < surah_from | reject | — | reject (valid_progress_range) |
| surah 115 | reject | reject | — (surah CHECK 1..114) |
| recitation error, surah_num null, real | reject | — | reject (surah_required) |

## Scale (50k)

- Reads on `/student/progress` unchanged (no new JOIN on the hot path).
- Capture write: 1 progress row + N error rows per session; trigger does 1–2 PK lookups on a 114-row table (in shared buffers, effectively free).
- No per-render update, no admin fan-out. ✅ Scale Target Rule.
