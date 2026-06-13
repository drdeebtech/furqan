# 015 — PR #458 review remediation (CodeRabbit + Cursor bots)

**Type:** review-finding remediation. **Date:** 2026-06-13. **Branch:** refactor/follow-up-collapse (PR #458).
**Lenses:** 📖 Quran integrity (ayah-range correctness) · 🛠 engineer (error handling, migration robustness, test fidelity).

All findings below were **independently verified against branch HEAD `aed6db8`** before inclusion
(stale/already-addressed bot threads excluded — e.g. the `old.teacher_id` self-confirm finding is
already fixed).

## Substantive (must fix before merge)

### S1 — `src/lib/domains/follow-up/manage.ts` — reject ayah values when `surah_number` is null  (📖 Major)
The range-validation block only validates when `sn != null`. If `surah_number` is null but
`ayah_start`/`ayah_end` are provided, the values pass unvalidated → an orphan ayah range with no surah.
**Fix:** add a guard — if `sn == null && (as != null || ae != null)`, throw `FollowUpUserError`
(Arabic message, consistent with the sibling guard) rejecting ayah values without a surah. Keep the
existing `sn != null && (as == null || ae == null)` guard. Net rule: surah and both ayahs are all-set
or all-null; no partial combination.

### S2 — `src/lib/domains/follow-up/actions.ts` (auto-regen ~L308) — normalize partial inherited ranges  (📖 Major)
Auto-regen only normalizes-to-null when **all three** of surah/start/end are non-null. A *partial*
inherited range (one field null) is inserted as-is and is rejected by the `homework_ayah_range_guard`
CHECK → regen insert fails. **Fix:** before the insert, if the three are not *all* non-null, set all
three (`regenSurah/regenAyahStart/regenAyahEnd`) to null (a partial range carries no valid memorization
target). Preserve the existing best-effort try/catch and the `validateRange`-on-complete-range path.

### S3 — `src/lib/actions/follow-up.ts:~373` — don't collapse read failures into "not found"  (🛠 silent-failure)
`const { data: hw } = await supabase…single()` discards `error`; `if (!hw) return { error: "المتابعة غير
موجودة" }` reports infra/RLS failures as *not found*. **Fix:** capture `error`; on a real error (not
PGRST116/no-row) `logError(...)` and return a distinct infra message (e.g. "تعذّر تحميل المتابعة");
return the not-found message only when `error` is absent (or PGRST116) and `hw` is null. Match the
error-handling pattern already used by `createSignedUrl` a few lines below.

### S4 — `supabase/migrations/20260612004838_homework_assignments_ayah_range_guard.sql` — scope constraint checks  (🛠 Major)
The three `if not exists (select 1 from pg_constraint where conname = '…')` checks are not scoped to the
table. `conname` is unique per-schema, not globally — a same-named constraint on another relation
false-negatives and **silently skips** adding the guard. **Fix:** add
`and conrelid = 'public.homework_assignments'::regclass` to each existence check. New forward migration
is NOT needed — this migration is un-applied on prod (PR not merged), so edit it in place. Keep
idempotency; keep `public.` qualification.

### S5 — `src/lib/actions/follow-up-zod.test.ts` — test the real schemas, not local copies  (test fidelity)
The test re-declares local `gradeFollowUpSchema` / `editFollowUpUpdatesSchema` instead of importing the
production schemas, so the suite stays green even if prod validation regresses. **Fix:** import the
actual schemas from their production module (`src/lib/actions/follow-up.ts` or wherever they are
exported — export them if not already) and assert against those. If exporting is undesirable, replace
with tests that call the real server-action validation path. The assertions themselves stay; only the
subject-under-test changes to the production object.

## Cosmetic (quick wins — clear the remaining CodeRabbit comments)

- **C1** `specs/013-progress-action-hardening/plan.md:65` & **C2** `…/spec.md:35` — markdownlint MD022/MD031
  blank-line violations (blank line above/below headings & fenced blocks).
- **C3** `specs/014-session-participant-secdef/tasks.md:~31-34` — make the verification query an exact
  catalog lookup: `... from pg_proc p join pg_language l on p.prolang = l.oid where p.oid =
  'public.user_is_session_participant(uuid)'::regprocedure` selecting `p.prosecdef, p.provolatile,
  l.lanname` (prove language). Doc-only.

## Out of scope (verified, do NOT touch)
- `supabase/migrations/20260428000000_remote_baseline.sql` cursor[bot] "anon grant / public_profiles"
  findings (L9048-9049): the baseline is the immutable prod dump (spec 011). Any real fix ships as a
  **separate forward migration** under a future spec — not by editing the baseline. Log as a follow-up,
  do not change here.
- The `old.teacher_id` self-confirm finding: already fixed at HEAD (CodeRabbit marked ✅ Addressed).
