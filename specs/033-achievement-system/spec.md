# Spec 033 — Student Achievement System (badges, level-ups, milestones)

Closes #552. A light, gamified badge layer pointing at events that already fire,
with an idempotent award primitive, a dashboard shelf, and bell notifications.
Realtime celebration is Phase 2 (depends on #526 / Spec 032).

Build sheet. **Claude planned it; Codex implements.**

---

## Three-lens check
- 🛠 Engineer: idempotency in the DB constraint (`UNIQUE(student_id, type)`), not app logic; one award primitive (no scattered notify/emit); writes service-role only (no authed INSERT policy); streak side-effect in `after()` (never blocks render); typed `FurqanEvent`.
- 📖 Quran teacher: every milestone ties to *real* hifz progress — `first_juz` rides the verified juz-coverage pipeline (canonical `ayah-counts`), never a fabricated count. Badges store no Quran text (`metadata_json` holds only juz number / streak length). Certificates remain the authoritative juz/level record; badges are a motivational pointer, not a competing source of truth.
- 🎓 Platform: RTL-Arabic labels (catalog ar-first); locked-badge greyscale for aspirational pull; reuses the bell (no new noise); `aria-live` shelf; honors quiet hours via `notify()`.

## What already exists (reuse — do NOT rebuild)
- `recordProgress()` (`src/lib/domains/progress/capture.ts`) — single hifz write seam; already calls `detectJuzCompletions()` → idempotent `issueCertificate()` + emits `progress.juz_completed`.
- Certificates already ARE the heavyweight per-juz/per-level achievement (#539 treats certs-as-achievements). Badges are a lighter layer pointing at the same events — **don't duplicate**.
- Streak already computed: `getStudentStreak()` (`src/lib/dashboard-queries.ts`) → `streakInfo.streak` in `src/lib/views/student-dashboard.ts`. No new streak math, no cron.
- `notify()`, `emitEvent`, honor board (separate ranking surface — leave alone).
- Session completion seam: `endSession()` in `src/lib/domains/session/orchestrate.ts` emits `session.ended`.

## Decisions (settled)
1. **Single earned table** (the issue's own schema). Badge *definitions* live in a **TS catalog** (`catalog.ts`), not a DB table — static, not user-editable (YAGNI; promote to a table only if admin-managed badges are ever wanted).
2. **One award seam** `src/lib/domains/achievements/award.ts`:
   `awardAchievement(admin, studentId, type, metadata?) → {awarded}`. Service-role insert; on `23505` (already earned) → `{awarded:false}`, no notify/emit; on new row → emit `achievement.unlocked` + `notify()` (RTL title from catalog). **The only place** that writes/notifies. DB UNIQUE constraint = the lock (no `automation_logs` ceremony — a badge has no expensive payload).
3. **Taxonomy** maps onto events that already fire:
   | `type` | trigger (existing seam) |
   |---|---|
   | `first_session` | `endSession()` / `session.ended` |
   | `first_juz` | `announceJuzCompletion()` in juz-completion.ts |
   | `streak_7`, `streak_30` | `streakInfo.streak` at dashboard-load (via `after()`) |
   | `level_up_intermediate`, `level_up_advanced` | `recordProgress()` when `input.level` advances past prior max |
   | `first_correction_clean` | review path — **OPEN, see below** |
4. **No XP/points engine.** The issue says the *lack* of milestones is the problem, not that we need XP. "Level-up" = transitions of the existing `level` field, as milestone badges. (If XP is wanted, separate spec.)
5. **Celebrations:** Phase 1 ships **no Pusher modal** — bell + shelf cover the signal. Optional P1 fallback: on dashboard load compare newest `unlocked_at` vs a `localStorage` timestamp → lightweight client modal (no DB column). Phase 2 (Spec 032): swap to realtime `achievement.unlocked` (emit already fires).

## Data model
```sql
-- supabase/migrations/<ts>_achievements.sql (sorts after baseline)
create table public.achievements (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references auth.users(id) on delete cascade,
  type          text not null check (type in (
                  'first_session','first_juz','streak_7','streak_30',
                  'first_correction_clean','level_up_intermediate','level_up_advanced')),
  metadata_json jsonb not null default '{}'::jsonb,
  unlocked_at   timestamptz not null default now(),
  unique (student_id, type)
);
alter table public.achievements enable row level security;
create policy achievements_select_own on public.achievements
  for select using (auth.uid() = student_id);
create policy achievements_select_teacher on public.achievements
  for select using (exists (
    select 1 from public.bookings b
    where b.student_id = achievements.student_id and b.teacher_id = auth.uid()));
-- NO insert/update/delete policy → writes only via service-role.
create index achievements_student_idx on public.achievements(student_id);
```

## UI
- **Achievement shelf** `src/app/student/dashboard/achievement-shelf.tsx` (client, RTL): earned badges full-color w/ `unlocked_at`; unearned shown locked/greyscale. Earned list added to the dashboard view payload (one `select` in `student-dashboard.ts`), rendered near the welcome header. Labels/icons from `catalog.ts` (ar+en, lucide).
- **Level-up indicator:** reuse the `level` chip in `welcome-header.tsx`; small "new" pulse on a just-awarded `level_up_*`.

## Files
Add: the migration; `src/lib/domains/achievements/award.ts` (+`award.test.ts`); `src/lib/domains/achievements/catalog.ts`; `src/app/student/dashboard/achievement-shelf.tsx`.
Edit: `src/lib/automation/emit.ts` (`"achievement.unlocked"` → WEBHOOK_ROUTES); `orchestrate.ts` (`first_session`); `juz-completion.ts` (`first_juz`); `capture.ts` (`level_up_*`, and `first_correction_clean` once resolved); `student-dashboard.ts` (`after()` streak eval + fetch earned into payload); `dashboard/page.tsx` (render shelf); `src/types/database.ts` (add `Achievement` alias + `npm run db:types`, never blind-regen — spec 026).

## OPEN DECISIONS (confirm before build)
- **`first_correction_clean` is contradictory** — a `correction` session *requires* ≥1 error (#533), so "clean correction" can't mean zero errors. Likely "first review session at top quality_rating with no errors." Confirm semantics; defer this one badge until answered (everything else is unambiguous).
- **"Visible on student profile"** — no `/student/profile` route exists; the shelf goes on `/student/dashboard` (the student home). Sign off.

## Risks + tests + phasing
- Side-effect on read (streak award at load) — mitigated by `after()` + idempotent insert (mirrors the existing read-side juz pattern).
- Type drift in `database.ts` — add alias + regen, never blind-regen.
- Notification spam — guarded: notify only on `awarded:true`.
- Tests: `award.test.ts` (second call no-ops, emits only first, catalog completeness); RLS (student own / teacher-of-student / unrelated teacher denied / authed INSERT denied); trigger tests (`first_session` once, `first_juz` from event, `streak_7/30` boundary). Pre-test: read each handler first (assert actual idempotent return).
- **Phase 1 (no #526):** migration+RLS, `awardAchievement`, catalog, wire `first_session`/`first_juz`/`streak_*`/`level_up_*`, shelf, bell. Meets all criteria except the realtime modal. **Phase 2 (Spec 032):** realtime celebration off `achievement.unlocked`.

## Dependencies
#540 (events/certs — spine, merged); #539/Spec 031 (certs-as-achievements — keep certs authoritative, badges point at them); #526/Spec 032 (realtime modal — Phase 2); honor board (untouched).
