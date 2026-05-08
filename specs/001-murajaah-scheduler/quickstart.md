# Quickstart — Murajaah Scheduler

How to run and test Murajaah locally before shipping. Phase 1 of `/speckit.plan`.

---

## Prereqs

1. FURQAN local dev stack running: `npm run dev` against the Supabase project.
2. Migration `20260509000000_murajaah_scheduler.sql` applied locally:
   ```bash
   npx supabase db push --linked --dry-run    # check what would apply
   npx supabase db push --linked              # actually apply
   ```
3. At least one seed student with ≥ 5 `student_progress` rows (use the existing `scripts/seed-test-data.ts` helper or insert manually).

---

## 1. Run the cron manually

The nightly compute is normally triggered by n8n. To run it locally:

```bash
psql "$SUPABASE_DB_URL" -c "select * from public.compute_murajaah_batch_for_date(current_date + interval '1 day');"
```

Expected output:

```
 students_processed | rows_scheduled
--------------------+----------------
                  3 |             14
```

(Numbers vary based on seed data.) Re-running the same command should return the same numbers (idempotent).

---

## 2. Verify the dashboard

1. Sign in as a seed student.
2. Navigate to `/student/dashboard`.
3. The "مراجعة اليوم" card should appear above upcoming sessions, listing 5–15 rows.
4. Click "أنهيت المراجعة" on any row.
5. Confirm:
   - Row vanishes from the card.
   - Toast / `<ActionFeedback>` confirms success.
   - Re-querying `student_review_schedule` shows `last_reviewed_at = now()` and `batch_for_date IS NULL` for that row.

If the card is empty, your seed student has no due rows — re-run step 1 with an earlier date or seed older `student_progress` rows.

---

## 3. Verify the teacher panel

1. Sign in as a teacher who's assigned to that student.
2. Navigate to `/teacher/students/<student-uuid>`.
3. Scroll to "مراجعة قادمة" — should show a 30-day forward queue.
4. If the student has rows >7 days overdue (you can age them with `update student_review_schedule set next_review_at = now() - interval '10 days' where student_id = <uuid>;`), the "تحتاج إعادة تعليم" panel surfaces.
5. Click "تم إعادة التعليم" on a reteach row.
6. Confirm: `lapse_count` incremented, EF reduced by `sm2_lapse_penalty`, `next_review_at = now() + 1 day`.

---

## 4. Verify the admin tune flow

1. Sign in as admin → `/admin/settings`.
2. Find "إعدادات المراجعة".
3. Change `sm2_easiness_factor` from 2.5 to 2.7. Submit.
4. Confirm:
   - Toast confirms success.
   - `audit_log` has a new entry.
   - **Existing** `student_review_schedule` rows are unchanged (constitution Principle: admin EF is initial-only).
   - A **new** row created via the next cron run uses `easiness_factor = 2.7`.

---

## 5. Run the test suite

```bash
# Unit tests — domain layer + SQL function smoke tests
npm run test src/lib/domains/progress/murajaah.test.ts

# E2E — student → teacher → admin flow
npx playwright test tests/e2e/murajaah-flow.spec.ts

# Type check
npx tsc --noEmit

# Build
npx next build
```

All four must pass before opening the PR.

---

## 6. Sanity-check at scale (optional)

Before promoting to production, run the cron against a synthetic 10k-student dataset to validate the <30 min budget:

```bash
psql "$SUPABASE_DB_URL" -c "
\\timing on
select * from public.compute_murajaah_batch_for_date(current_date + interval '1 day');
"
```

Time should land under 6 minutes for 10k students; linear-extrapolated 50k is ~30 minutes which is the budget. If wall-clock exceeds 60 seconds for 10k, escalate to research.md §"Cron sizing" before shipping — the index plan may need adjustment.
