# Tasks: AI/LLM Workflows

**Input**: `specs/028-ai-llm-workflows/` (this file)  
**Plan**: See conversation context — plan approved 2026-06-24  
**Branch**: `028-ai-llm-workflows`  
**Status**: Tasks-ready

---

## Ground rules for the builder

- Do not launch sub-agents. Execute all tasks directly.
- Run `npx tsc --noEmit` + `npm run lint` + `npm run test:unit` before marking any phase done.
- Run `npm run build` (not just tsc) before the final commit — Turbopack catches boundary errors tsc misses.
- All n8n workflow creation/updates go through the `mcp__n8n-mcp__*` tools.
- LLM provider inside n8n: **Anthropic** (`anthropicApi` credential, already configured by user).
  - Content generation workflows (monthly-progress-ai, curriculum-advisor): `claude-sonnet-4-6`
  - Classification/analysis workflows (weakness-detector, coaching-insight, risk-classifier, matching-advisor): `claude-haiku-4-5-20251001`
- Every new n8n workflow MUST be added to both:
  - `scripts/n8n-harden/run.mjs` TARGETS list
  - `scripts/n8n-harden/wire-error-workflow.mjs` TARGETS list
- Every new n8n workflow MUST write to `automation_logs` on run AND on failure.
- `src/types/database.ts` is hand-corrected — never blind-regen it. Add new table types manually at the bottom alias section.

---

## Phase 1: DB Migration + Prerequisite Verification

**Purpose**: Create the eval gate table and confirm feature flags exist before building any workflow.

- [ ] T001 Verify user has added Anthropic API key to n8n credentials (credential name `Anthropic FURQAN` or similar). If not present, STOP and ask — all subsequent phases depend on it.
- [ ] T002 Run `supabase migration new ai_output_review` then write the migration to `supabase/migrations/<timestamp>_ai_output_review.sql`:

```sql
create table ai_output_review (
  id uuid primary key default gen_random_uuid(),
  workflow_name text not null,
  entity_type text not null,
  entity_id uuid not null,
  output_text text not null,
  output_json jsonb,
  status text not null default 'pending_review'
    check (status in ('pending_review','approved','rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  auto_send_eligible boolean not null default false,
  created_at timestamptz not null default now()
);

alter table ai_output_review enable row level security;

create policy "Admins manage ai_output_review"
  on ai_output_review for all
  using (is_admin())
  with check (is_admin());

create index idx_aior_pending on ai_output_review (workflow_name, created_at)
  where status = 'pending_review';

comment on table ai_output_review is
  'Holds AI-generated outputs pending admin approval before delivery to end users.';
```

- [ ] T003 Run `supabase migration up` locally. Verify table exists. Run `npm run db:types` then manually append the `AiOutputReview` type alias to the bottom of `src/types/database.ts` (do NOT regen the full file).
- [ ] T004 Push migration to production: `supabase db push`.
- [ ] T005 Verify feature flags in DB. Run:
  ```sql
  select key, value from platform_settings
  where key in (
    'ai_parent_reports_enabled','ai_coaching_enabled',
    'ai_weakness_detection_enabled','ai_risk_classifier_enabled',
    'ai_curriculum_advisor_enabled','ai_matching_advisor_enabled'
  );
  ```
  If any are missing, insert them with `value = 'false'` via migration `<timestamp>_ai_feature_flags.sql`.

**Checkpoint**: `ai_output_review` table exists in prod. Feature flags present. Anthropic credential confirmed in n8n.

---

## Phase 2: weakness-detector workflow

**Purpose**: Identify top-3 weak suwar/ayat per student from SM-2 data. Internal only — feeds `retention_signals`.

- [ ] T006 Create n8n workflow `furqan-weakness-detector` via `mcp__n8n-mcp__n8n_create_workflow`. Structure:
  - **Trigger**: Schedule — daily at 03:00 UTC
  - **Check flag**: HTTP GET `supabase/rest/v1/platform_settings?key=eq.ai_weakness_detection_enabled&select=value` → IF value ≠ 'true', stop
  - **Fetch students**: HTTP GET `supabase/rest/v1/student_review_schedule?select=student_id,surah_number,ayah_number,ease_factor,interval_days,repetitions,next_review_at` with Supabase FURQAN credential; filter `ease_factor=lt.2.0` (struggling items)
  - **Group by student**: Code node — group records by `student_id`, compute per-surah struggle score = count of items with ease < 2.0
  - **LLM analysis**: Anthropic Chat Model node (`claude-haiku-4-5-20251001`). System prompt:
    ```
    You are an expert Quran memorization coach analyzing a student's spaced-repetition data.
    Given a student's struggling items (ease_factor < 2.0), identify the top 3 surah/ayah
    ranges that need the most reinforcement. Return JSON only:
    {"weak_areas": [{"surah": N, "ayah_range": "X-Y", "reason": "brief Arabic/English note"}]}
    Do not generate or modify any Quran text. Reference surahs by number only.
    ```
  - **Upsert to retention_signals**: HTTP PATCH `supabase/rest/v1/retention_signals?student_id=eq.{{ $json.student_id }}` with `weakness_json` column (add column in a separate migration if not present — check first).
  - **Log Run** + **Log Failure** nodes connected to trigger.
- [ ] T007 Add `["<workflow-id>", "weakness-detector"]` to `scripts/n8n-harden/run.mjs` TARGETS and `wire-error-workflow.mjs` TARGETS.
- [ ] T008 Run hardener: `node scripts/n8n-harden/run.mjs weakness-detector` then `node scripts/n8n-harden/wire-error-workflow.mjs weakness-detector`.
- [ ] T009 Add `"weakness-detector"` entry to `src/lib/n8n/workflow-descriptions.ts` META:
  ```ts
  "weakness-detector": {
    ar: "تحليل يومي لبيانات المراجعة المتباعدة لكل طالب وتحديد أضعف المقاطع.",
    en: "Daily SM-2 analysis per student — surfaces top-3 weak suwar/ayat ranges.",
    area: "pedagogy",
  },
  ```
- [ ] T010 Activate workflow via `mcp__n8n-mcp__n8n_update_partial_workflow` with `{type: "activateWorkflow"}`.

**Checkpoint**: `furqan-weakness-detector` active, hardened, writing to `retention_signals`.

---

## Phase 3: coaching-insight workflow

**Purpose**: Per-teacher coaching note for each student in their cohort. Teacher-facing.

- [ ] T011 Create n8n workflow `furqan-coaching-insight` via `mcp__n8n-mcp__n8n_create_workflow`. Structure:
  - **Trigger**: Schedule — weekly, Sunday 05:00 UTC
  - **Check flag**: `ai_coaching_enabled` (same pattern as T006)
  - **Fetch teacher cohorts**: HTTP GET `supabase/rest/v1/bookings?status=eq.completed&select=teacher_id,student_id,session_feedback,completed_at` last 30 days, grouped by teacher
  - **For each teacher → for each student**: Code node builds per-student summary (session count, avg feedback sentiment from existing data, last SM-2 ease score from `student_review_schedule`)
  - **LLM**: Anthropic `claude-haiku-4-5-20251001`. System prompt:
    ```
    You are a pedagogical advisor helping a Quran teacher. Given a student's recent session
    history and spaced-repetition performance, write ONE coaching note (2-3 sentences, Arabic
    or English matching the teacher's language preference) suggesting what to focus on in the
    next session. Do not generate Quran text. Reference surah numbers only.
    Return JSON: {"student_id": "...", "coaching_note": "..."}
    ```
  - **Insert to notifications**: Supabase insert into `notifications` with `type='coaching_insight'`, `user_id=teacher_id`, `body=coaching_note`
  - **Log** each delivery to `automation_logs`
- [ ] T012 Add to both harden targets, run hardener, add META entry (`area: "pedagogy"`), activate.

**Checkpoint**: `furqan-coaching-insight` active, delivering weekly teacher coaching notes.

---

## Phase 4: risk-classifier workflow

**Purpose**: Augment existing numeric risk scores with qualitative reason + intervention suggestion.

- [ ] T013 Create n8n workflow `furqan-risk-classifier` via `mcp__n8n-mcp__n8n_create_workflow`. Structure:
  - **Trigger**: Schedule — daily at 04:00 UTC (after `student-at-risk-detector` runs)
  - **Check flag**: `ai_risk_classifier_enabled`
  - **Fetch high-risk students**: HTTP GET `supabase/rest/v1/retention_signals?risk_score=gte.70&select=student_id,risk_score,days_inactive,sessions_missed,package_sessions_remaining`
  - **LLM**: Anthropic `claude-haiku-4-5-20251001`. System prompt:
    ```
    You are a student retention specialist for a Quran memorization platform.
    Given a student's risk signals, classify the PRIMARY reason for churn risk
    and suggest ONE specific intervention.
    Reasons: academic_struggle | scheduling_conflict | disengagement | financial_pressure | unknown
    Return JSON only:
    {"student_id": "...", "risk_reason": "...", "intervention": "1-sentence action for the teacher/admin"}
    ```
  - **Upsert to retention_signals**: PATCH `risk_reason` and `intervention_suggestion` columns (check column exists first; add via migration if not)
  - **Log**
- [ ] T014 Add to harden targets, run hardener, add META entry (`area: "retention"`), activate.

**Checkpoint**: `furqan-risk-classifier` active, enriching `retention_signals` with qualitative classification.

---

## Phase 5: monthly-progress-ai workflow (eval gate — HIGH RISK)

**Purpose**: AI-generated Arabic parent report. MUST go through `ai_output_review` — never auto-send until 30+ approvals.

- [ ] T015 Create n8n workflow `furqan-monthly-progress-ai` via `mcp__n8n-mcp__n8n_create_workflow`. Structure:
  - **Trigger**: Schedule — 1st of each month at 06:00 UTC
  - **Check flag**: `ai_parent_reports_enabled`
  - **Fetch student data**: HTTP GET joining `bookings` (last 30 days, status=completed), `student_progress` (ayat range covered), `student_review_schedule` (SM-2 averages), `milestones` (recent achievements) — use Supabase FURQAN service-role credential
  - **LLM**: Anthropic `claude-sonnet-4-6`. System prompt:
    ```
    You are a warm, professional Quran teacher writing a monthly progress report for a student's parent.
    Write exactly 3 paragraphs in Arabic (formal but warm). Structure:
    1. Overall progress this month (sessions attended, ayat covered — use the numbers given, do not fabricate)
    2. What is going well (specific SM-2 improvement areas)
    3. What to encourage at home (based on weak areas)
    CRITICAL: Do not generate, modify, or quote any Quran text or ayat. Reference progress by
    surah number and ayah count only. Do not invent statistics.
    Return JSON: {"student_id": "...", "report_ar": "...", "summary_en": "one-line English summary for admin"}
    ```
  - **Insert to ai_output_review**: Supabase insert with `workflow_name='monthly-progress-ai'`, `entity_type='student'`, `status='pending_review'`. Do NOT insert to `parent_reports` yet.
  - **Telegram alert to admin**: HTTP POST to Telegram bot (`https://api.telegram.org/bot<TOKEN>/sendMessage`, chat_id=707213038) — "📋 {N} monthly student reports ready for review at /admin/ai-review"
  - **Log**
- [ ] T016 Add to harden targets, run hardener, add META entry (`area: "reports"`), **do not activate yet** — leave inactive until admin review UI exists (T023).

**Checkpoint**: `furqan-monthly-progress-ai` created and hardened. Inactive pending review UI.

---

## Phase 6: curriculum-advisor workflow (eval gate — HIGH RISK)

**Purpose**: Recommend next surah/section per student. Teacher-facing but touches curriculum — Quran teacher lens mandatory.

- [ ] T017 Create n8n workflow `furqan-curriculum-advisor` via `mcp__n8n-mcp__n8n_create_workflow`. Structure:
  - **Trigger**: Schedule — weekly, Saturday 05:00 UTC
  - **Check flag**: `ai_curriculum_advisor_enabled`
  - **Fetch**: student current position from `student_progress` + teacher teaching pace (sessions/month from `bookings`) + SM-2 interval averages from `student_review_schedule`
  - **LLM**: Anthropic `claude-sonnet-4-6`. System prompt:
    ```
    You are an experienced Quran memorization curriculum advisor.
    Given a student's current memorization position and their teacher's typical pace,
    recommend what to focus on next and flag any pace concerns.
    CRITICAL: Do not generate, write, or quote any Quran text or ayat.
    Reference only by surah number and ayah range. Never correct or modify Quran text.
    If pace seems too fast or too slow, explain why.
    Return JSON:
    {"student_id": "...", "recommendation": "teacher-facing note in Arabic or English", "pace_flag": "ok|too_fast|too_slow", "pace_note": "..."}
    ```
  - **Insert to ai_output_review**: `workflow_name='curriculum-advisor'`, `entity_type='teacher'`, `entity_id=teacher_id`
  - **Telegram alert**: same pattern as T015
  - **Log**
- [ ] T018 Add to harden targets, run hardener, add META entry (`area: "pedagogy"`), **leave inactive** until review UI exists.

**Checkpoint**: `furqan-curriculum-advisor` created and hardened. Inactive pending review UI.

---

## Phase 7: matching-advisor workflow

**Purpose**: Rank teacher matches for a new student at onboarding. One-time per student.

- [ ] T019 Create n8n workflow `furqan-matching-advisor` via `mcp__n8n-mcp__n8n_create_workflow`. Structure:
  - **Trigger**: Webhook (event: `student.onboarding_complete`) — receives `student_id`, student preferences from `student_profiles`
  - **Check flag**: `ai_matching_advisor_enabled`
  - **Fetch teachers**: HTTP GET `supabase/rest/v1/teacher_profiles?cv_status=eq.approved&is_accepting=eq.true&select=teacher_id,specialization,teaching_style,gender,available_slots`
  - **Fetch student prefs**: gender preference, schedule windows, goal (hifz/tajweed/revision), age group from `student_profiles`
  - **LLM**: Anthropic `claude-haiku-4-5-20251001`. System prompt:
    ```
    You are a student-teacher matching advisor for a Quran memorization platform.
    Given a new student's preferences and a list of available teachers, rank the top 3
    best matches and explain why each is suitable.
    Consider: gender preference (hard constraint if specified), specialization match,
    schedule overlap, teaching style vs. student goal.
    Return JSON:
    {"student_id": "...", "matches": [{"teacher_id": "...", "rank": 1, "reason": "..."}]}
    Return exactly 3 matches. If fewer than 3 teachers are available, return all available.
    ```
  - **Upsert to student_profiles**: write `recommended_teacher_ids` array (add column via migration if absent — check first)
  - **Log**
- [ ] T020 Add to harden targets (note: webhook trigger — hardener adds Log Failure but trigger port is webhook, not schedule), run hardener, add META entry (`area: "onboarding"`), activate.

**Checkpoint**: `furqan-matching-advisor` active on webhook trigger.

---

## Phase 8: Admin review UI for eval gate workflows

**Purpose**: Allow admin to approve/reject outputs from monthly-progress-ai and curriculum-advisor before delivery.

- [ ] T021 Check `src/app/admin/` for existing patterns. Add page `src/app/admin/ai-review/page.tsx` — server component that reads `ai_output_review` where `status='pending_review'`, renders list with approve/reject buttons. Use existing admin layout and auth pattern.
- [ ] T022 Add server actions `src/lib/actions/admin-ai-review.ts`:
  - `approveAiOutput(id: string)`: sets `status='approved'`, `reviewed_by`, `reviewed_at`; for `monthly-progress-ai` outputs: inserts to `parent_reports` with `sent_at = now()`; for `curriculum-advisor`: sends in-app notification to teacher
  - `rejectAiOutput(id: string, reason: string)`: sets `status='rejected'`, `rejection_reason`
  - Check `auto_send_eligible` gate: after each approval, count approvals vs. rejections for that workflow; if approval rate ≥ 90% and total approvals ≥ 30, set `auto_send_eligible = true` on future outputs (log to `automation_logs`)
- [ ] T023 Run `npx tsc --noEmit` — fix any type errors before proceeding.
- [ ] T024 Activate `furqan-monthly-progress-ai` (T016) and `furqan-curriculum-advisor` (T018) now that review UI exists.

**Checkpoint**: Admin review page live. Both eval-gate workflows active.

---

## Phase 9: Register all 6 in workflow-descriptions.ts

- [ ] T025 Verify all 6 META entries are present in `src/lib/n8n/workflow-descriptions.ts` (weakness-detector added in T009, coaching-insight in T012, risk-classifier in T014, monthly-progress-ai in T016, curriculum-advisor in T018, matching-advisor in T020). Add any missing.

---

## Phase 10: Final verification

- [ ] T026 Run `npm run test:unit` — all existing tests must pass. Fix regressions, do not skip.
- [ ] T027 Run `npm run lint` — zero errors.
- [ ] T028 Run `npx tsc --noEmit` — zero errors.
- [ ] T029 Run `npm run build` — must succeed. Fix any Turbopack/boundary errors.
- [ ] T030 Run `node scripts/n8n-harden/run.mjs` with no args to verify all 6 workflows appear in TARGETS and hardening passes.
- [ ] T031 Commit: `feat(n8n): add 6 AI/LLM workflows with Anthropic + admin eval gate`

---

## Columns to add via migration if absent (check before creating)

- `retention_signals.weakness_json jsonb` — Phase 2
- `retention_signals.risk_reason text` — Phase 4
- `retention_signals.intervention_suggestion text` — Phase 4
- `student_profiles.recommended_teacher_ids uuid[]` — Phase 7

Check with `\d retention_signals` / `\d student_profiles` before writing the migration. If columns exist under a different name, use the existing name.

---

## Out of scope for this tasks.md

- No WhatsApp, Telegram bot commands, or calendar sync (separate specs)
- No changes to Quran text, surah/ayah counts, or tashkeel
- No RLS bypass — service-role key stays server/n8n only
- No AI model self-correction of student progress data — LLM reads and describes, never writes to `student_progress` directly
