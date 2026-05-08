# Research — Murajaah Scheduler

Phase 0 of `/speckit.plan`. Resolves the open technical questions for Phase 1 design at the 50,000-user scale target.

---

## SM-2 algorithm parameters

**Decision**: SM-2 with three tunable constants exposed in `platform_settings`:
- `sm2_initial_interval_days = 1` (first review at day 1 after first encounter)
- `sm2_easiness_factor = 2.5` (initial EF for new rows)
- `sm2_lapse_penalty = 0.8` (multiplied into EF on quality < 3)

Per-row EF is bounded `[1.3, 3.5]` per SuperMemo's published constraints — clamping prevents runaway "this card is impossible" or "this card is trivial" states.

Quality input from the student's button click maps:
- "أنهيت بسهولة" / clicked once → quality 5
- "أنهيت" / default → quality 4
- "احتجت مساعدة" → quality 3 (still passes; small EF dip)
- (no quality < 3 path on the student card; lapses come from the teacher reteach action)

**Rationale**: SuperMemo's SM-2 is the most cited spaced-repetition algorithm in active production use (Anki, SuperMemo itself, mochi.cards). Its math is documented and stable since 1985. FSRS produces marginally better intervals but requires a much larger training set per user — overkill for v1.

**Alternatives considered**:
- **FSRS (Free Spaced Repetition Scheduler)** — better math, requires per-user model training. Defer to v2 once we have ≥6 months of review-quality data at 50k scale.
- **Leitner box system** — simpler, but no per-card adaptation; abandoned by every modern SRS app.
- **Static intervals** — what FURQAN today *almost* does; no learning signal. Rejected because the whole point of this feature is adaptive review.

---

## Cron sizing — 50k × ~200 rows

**Decision**: Single Postgres function `compute_murajaah_batch_for_date(p_date date)` invoked by an n8n nightly workflow at 02:00 UTC. Function processes all students in one transaction-per-batch using a server-side cursor; commits per-student to keep the transaction window short.

Math:
- 50,000 students × 200 `student_progress` rows avg = 10M rows to evaluate.
- Per-row work: read schedule row, compute `next_review_at - now()`, decide if it falls in the 7-day fresh window, append to today's batch if yes (cap 15/student).
- Postgres can comfortably do ~500k indexed evaluations/second on Supabase Pro hardware, so a sequential scan with index seeks completes in ~20–25 seconds CPU.
- Wall-clock ~10–15 minutes including I/O and per-student commits.

**Index strategy** (see data-model.md for DDL):
- `idx_student_review_schedule__student_next_review` on `(student_id, next_review_at)` — drives the per-student "find rows in fresh window" seek.
- `idx_student_review_schedule__batch_for_date` on `(batch_for_date)` WHERE `batch_for_date IS NOT NULL` — drives the dashboard SELECT.
- `idx_student_review_schedule__teacher_reteach` on `(student_id, next_review_at) WHERE next_review_at < now() - interval '7 days'` — partial index for the teacher reteach queue.

**Rationale**: Three indexes cover all three hot queries with index-only scans. The partial index on the reteach queue is small (most rows are not >7 days overdue) and avoids polluting the primary index.

**Alternatives considered**:
- **Per-user n8n workflow** (50k workflow runs/night) — rejected. n8n queue overhead would dominate; lock contention on `automation_logs` would explode.
- **pg_cron** — rejected. The existing FURQAN convention is n8n on Mac mini for sub-daily/specialised cron; daily compute jobs follow the same pattern for operational consistency. The healthcheck pairing (`/api/cron/n8n-healthcheck`) is already wired.
- **Vercel cron** — rejected per CLAUDE.md "Cron jobs go on n8n, not Vercel" rule.

---

## Postgres function shape — idempotency

**Decision**: Function uses `INSERT ... ON CONFLICT (student_id, progress_id, batch_for_date) DO NOTHING` on a unique constraint. Re-running for the same `p_date` produces zero new rows.

Idempotency contract:
- First run for `p_date = '2026-05-09'` writes today's batch.
- Second run for the same date: zero new inserts, zero errors, returns row count 0.
- Run for `p_date = '2026-05-10'` after `2026-05-09`: writes tomorrow's batch normally.

**Rationale**: Cron retries (n8n's automatic retry on transient failure) must never duplicate batch rows. The unique constraint + `ON CONFLICT DO NOTHING` is the cheapest idempotency primitive Postgres offers.

**Alternatives considered**:
- **Advisory lock per date** — works but adds operational complexity; harder to reason about than a unique constraint.
- **Truncate + re-insert** — rejected. Concurrency-unsafe; would break if a student marks a review complete during the cron run.

---

## n8n workflow shape

**Decision**: Single workflow `murajaah-nightly-compute` registered in `automation/BLUEPRINT.md`:

- **Trigger**: cron `0 2 * * *` (02:00 UTC daily).
- **Step 1**: HTTP POST to Supabase RPC endpoint `compute_murajaah_batch_for_date`, passing `p_date = current_date + interval '1 day'` (compute *tomorrow's* batch, not today's, so morning students see fresh data).
- **Step 2**: On success, POST to FURQAN's existing `/api/webhooks/n8n` callback with `event: 'murajaah.compute.completed'` and the row count.
- **Step 3**: On failure, fire Telegram alert via existing self-healing pattern; the next morning's dashboard falls back to yesterday's leftover items per FR-012.
- **Healthcheck pairing**: `/api/cron/n8n-healthcheck` already polls n8n for failed runs daily; extend its check to verify a successful `murajaah.compute.completed` log entry exists for each of the last 3 days.

**Rationale**: Reuses the existing n8n + Telegram + automation_logs pattern from the 44 active FURQAN workflows. Zero new infrastructure shape.

---

## RLS at 10M-row scale

**Decision**: RLS predicate is `student_id = auth.uid()` for student reads, `student_id IN (SELECT student_id FROM teacher_assignments WHERE teacher_id = auth.uid())` for teacher reads, `true` for admin reads (admin role has separate gate). All three predicates can use the index on `(student_id, ...)` — Postgres applies RLS as an additional WHERE clause, so an index covering `student_id` makes the seek selective.

Critical: the predicate MUST NOT include any expression that prevents index usage (e.g., function calls on the indexed column). `student_id = auth.uid()` is the right shape; `lower(student_id::text) = auth.uid()::text` is *not*.

**Rationale**: At 10M rows, a sequential scan per RLS-checked query is unacceptable. Index-driven RLS is mandatory. The constitution's 50k flag #7 ("RLS predicates considered against a 10M-row table") is satisfied.

**Alternatives considered**:
- **Materialized views per role** — overkill for v1; introduces refresh-cadence ops debt.
- **Separate `student_review_schedule_public` view** — adds a read-path JOIN; rejected per Scale Target Rule §"hot-path JOINs."

---

## Quality button mapping & UX copy

**Decision**: Two buttons on each Murajaah row, mapping to two SM-2 quality values:
- **"أنهيت المراجعة" (default)** → quality 4. EF unchanged or slight increase.
- **"احتجت مساعدة" (secondary, smaller)** → quality 3. EF dip to ~2.3, next interval shorter but no lapse.

No "fail" button on the student side. A failed review = the teacher marks the row as "needs reteaching" via the teacher panel (FR-013), which is a different code path with a heavier penalty (`lapse_count++`, EF × 0.8).

**Rationale**: Per Scale Target Rule §"Returning-user UX" and the clarify Q2 decision, the student's daily card is for *maintenance review*, not failure handling. Failure handling lives with the teacher. Two buttons keep cognitive load low and align with this separation.

---

## Open questions deferred to /speckit.tasks or later

- **Localised cron timing** — should the 02:00 UTC trigger be replaced with per-region triggers (e.g., 02:00 Riyadh time = 23:00 UTC) once FURQAN has students in multiple major timezones? Defer until traffic data shows a meaningful timezone skew.
- **Quality 5 distinction** — is there a "أنهيت بسهولة" easy-button worth adding for power users to accelerate intervals? Defer to post-launch UX iteration.
- **Audio recording integration** — out of scope per spec.md.
