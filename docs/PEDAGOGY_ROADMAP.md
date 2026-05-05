# FURQAN — Pedagogy Roadmap (Design Specs)

> Companion document to the deep pedagogical analysis at
> `Project Memory/furqan/Runs/2026-05-04-2313-deep-pedagogical-analysis-student-benefit.md`.
> The analysis identified 10 ship-now items (built and merged 2026-05-04)
> plus a medium-build tier (3-12 months) and three strategic bets (12+ months).
> This doc is the design spec for everything not yet built.

## Status

| Item | Phase | Built? |
|---|---|---|
| #1–#10 | 0-3 months ship-now | ✅ Shipped 2026-05-04 (commits `fe90983` through `bc9b04f`) |
| #13 Recitation-audio archive | 3-12 months medium-build | ✅ Shipped 2026-05-04 (`ca3fa5a`) |
| #15 (student) Student timeline | 3-12 months medium-build | ✅ Shipped 2026-05-04 (`467adc0`) — student view |
| #15 (teacher) Teacher view of student timeline | 3-12 months medium-build | ✅ Shipped 2026-05-05 (`cb8b545`) — teacher view |
| #14 Ijazah pathway | 3-12 months medium-build | ✅ Shipped 2026-05-05 (`f0aabca`) — schema + student view; admin CRUD + teacher endorsement deferred |
| #17 Halaqa group sessions | 12+ months strategic bet | ✅ Shipped 2026-05-05 (`7368c2e`) — student discovery + request-to-join; pricing deferred |
| #18 Teacher mentorship | 12+ months strategic bet | ✅ Shipped 2026-05-05 (`9661e1e`) — schema + dashboard card; admin pairing UI + feedback-writing UI deferred |
| #11 Talqeen mode | 3-12 months medium-build | 📐 Design only — needs mushaf licensing decision |
| #12 AI Curriculum Advisor | 3-12 months medium-build | 📐 Design only — blocked on AI key |
| #15 (parent) Parent magic-link timeline | 3-12 months medium-build | 📐 Design only — needs parent-profile elevation decision |
| #16 AI tajweed correction | 12+ months strategic bet | 📐 Design only — Tarteel.ai conversation needed |

---

## #11 — Talqeen mode in live session

**What it is.** A split-screen mode inside the Daily.co live session where the teacher controls a "current ayah" pointer, the student sees the ayah on a shared mushaf, the teacher recites, the student echoes, and the teacher marks each ayah correct / needs-review in real time. Each marking writes a `recitation_errors` row.

**Why now.** Talqeen (تلقين) is the central act of classical Quran teaching — teacher recites, student repeats, teacher corrects. The platform's video sessions support this implicitly (two faces on screen) but provide no UI structure for it. Without a shared mushaf pointer the teacher and student can lose alignment ("which ayah are we on?"), and the granular per-ayah error capture that the schema already supports (`recitation_errors`) doesn't happen because the teacher would have to context-switch to a separate app to log errors mid-session.

**Architecture sketch.**
- **Real-time channel.** Use Supabase Realtime (`broadcast` channel scoped to the session_id) so teacher mouse-clicks on the mushaf propagate to the student in <100ms.
  - Channel name: `talqeen:session:{session_id}`
  - Events: `pointer_moved` (teacher → student), `ayah_marked` (teacher → student, both see the marking), `correction_note` (teacher → student, optional note attached to a mark)
- **Mushaf data source.** The platform already has Bunny.net for video CDN — use the same account or a static mushaf-image bucket. Simplest: pre-rendered mushaf-page PNGs (KFGQPC Madinah mushaf is a common reference — check licensing). For ayah granularity, overlay invisible click-targets per ayah computed from mushaf-page metadata (a JSON file mapping `page → [{surah, ayah, x, y, width, height}]`).
- **Per-ayah error capture.** When the teacher clicks an ayah and marks it "needs work", a modal opens with the existing `recitation_errors.error_type` enum: `makharij | sifat | madd | waqf | ghunna | other`. Optional note. On save, write a `recitation_errors` row tied to a fresh `student_progress` row with `progress_type='correction'`.
- **Recording.** Use Daily.co's existing room recording. After session ends, the recording becomes the student's audio archive entry (item #13).

**Code paths to touch.**
- `src/app/teacher/sessions/[id]/page.tsx` — add a "Start Talqeen mode" button when session is live.
- `src/app/teacher/sessions/[id]/talqeen-teacher-panel.tsx` — new file: teacher-side mushaf + controls.
- `src/app/student/sessions/[id]/page.tsx` — passive student-side mushaf view that reflects the teacher's pointer + markings.
- `src/lib/realtime/talqeen.ts` — new helper: subscribe/publish wrappers around Supabase Realtime for the channel.
- `public/mushaf/` — static assets (page images + ayah-position JSON).

**Brand fit.** ✅ Premium · Refined · Authentic. Talqeen is the most authentically Quranic interaction the platform could host. The mushaf imagery is the natural visual anchor.

**Build estimate.** ~3 weeks. The Supabase Realtime + mushaf assets + UI on both sides is the bulk; the per-ayah error capture reuses existing schema.

**What we'd need before building.** (1) Mushaf licensing — pick a reference mushaf and confirm we can host the page images. KFGQPC offers free licensing for non-commercial; commercial use needs a written agreement. (2) A short product session deciding whether the teacher's pointer is a click-only UI or a continuous mouse-trace overlay (some teachers prefer to "underline as I read").

---

## #12 — AI Curriculum Advisor (student-facing)

**What it is.** A weekly AI-generated paragraph of "your next focus" for the student, based on `recitation_errors` patterns + recent follow-up grades + the last 3 evaluations. Rendered as a notification + pinned card on the dashboard.

**Why now.** BLUEPRINT.md item 12.2 (AI Curriculum Advisor) is currently scoped for the teacher only. Mirror it for the student so the student also gets the benefit of the same AI synthesis. Compounds the value of items #1, #3, #6 from the analysis.

**Architecture sketch.**
- **n8n workflow.** New scheduled workflow runs weekly per active student.
  - Reads: 30 days of `recitation_errors` aggregated by `error_type`, last 3 `session_evaluations`, last 5 `homework_assignments` (status + grade).
  - Calls: Anthropic API (claude-haiku-4-5 or claude-sonnet-4-6 depending on quality threshold) with a constrained prompt (warm-but-grave tone per `.impeccable.md`, ban hallucinated facts, max 80 words).
  - Writes: row to a new `student_curriculum_advice` table.
  - Notifies: in-app notification + optional WhatsApp.
- **New table.**
  ```sql
  create table public.student_curriculum_advice (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.profiles(id),
    advice_text text not null,
    source_window_start timestamptz not null,
    source_window_end timestamptz not null,
    model_used text not null,
    generated_at timestamptz not null default now(),
    read_at timestamptz
  );
  alter table public.student_curriculum_advice enable row level security;
  create policy advice_student_read on public.student_curriculum_advice
    for select using (student_id = auth.uid());
  create policy advice_admin_full on public.student_curriculum_advice
    for all using (public.is_admin_or_mod());
  ```
- **Dashboard surface.** New card on `/student/dashboard` rendered above the Murajaah card when a fresh advice row exists for this week and `read_at IS NULL`.
- **Fallback.** When the AI call fails, write a structured-summary advice row using a deterministic template (matches BLUEPRINT.md "AI fails → fall back to structured non-AI summary").

**Code paths to touch.**
- `automation/specs/student-curriculum-advisor.md` — new workflow spec.
- `automation/json/n8n-furqan-student-curriculum-advisor.v1.json` — new workflow JSON.
- `automation/prompts/student-curriculum-advisor.ar.md` — new prompt.
- `supabase/migrations/<ts>_add_student_curriculum_advice.sql` — new migration.
- `src/app/student/dashboard/page.tsx` — add latest-advice query.
- `src/app/student/dashboard/curriculum-advice-card.tsx` — new component.
- `src/lib/actions/curriculum-advice.ts` — `markAdviceRead(id)` server action.

**Brand fit.** ✅ Refined. Single sentence per week, no celebration patterns. The teacher remains the relationship; the AI is framed as the teacher's helper, not the student's coach.

**Build estimate.** ~2 weeks. Blocked on Anthropic API key in n8n (per CLAUDE.md "blocked: needs Anthropic API key").

---

## #14 — Ijazah pathway as first-class

**What it is.** For students aiming at formal certification, a track surface showing where they are on the path to `ijazah` — required surahs memorized, required evaluations passed at threshold, hours with a single teacher, and the eventual chain-of-transmission record. The platform's `teacher_ijaza` table already records teacher credentials; this extends the same concept to students.

**Why now.** `.impeccable.md` explicitly names the audience as ranging from "a 7-year-old's first juz' to a hāfiz preparing for ijāzah". Without an ijazah surface, the most committed segment of the user base has no in-app representation of their highest goal.

**Architecture sketch.**
- **New tables.**
  ```sql
  -- An ijazah pathway is a defined credential the academy offers (e.g.
  -- "Hifz al-Quran complete in Hafs", "Tajweed mastery via Warsh"). One
  -- pathway, many requirements.
  create table public.ijazah_pathways (
    id uuid primary key default gen_random_uuid(),
    name_ar text not null,
    name_en text not null,
    description_ar text,
    description_en text,
    recitation_standard text not null check (recitation_standard in
      ('hafs','warsh','qalon','al_duri','shu_ba')),
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  );

  -- Requirements that compose a pathway. Type: 'memorize_surah' |
  -- 'memorize_juz' | 'min_sessions_with_teacher' | 'eval_score_threshold' |
  -- 'oral_exam_pass' | 'written_exam_pass'.
  create table public.ijazah_requirements (
    id uuid primary key default gen_random_uuid(),
    pathway_id uuid not null references public.ijazah_pathways(id) on delete cascade,
    requirement_type text not null,
    requirement_payload jsonb not null,
    sequence integer not null,
    description_ar text not null,
    description_en text not null,
    created_at timestamptz not null default now()
  );

  -- A student enrolled in a pathway. One student can pursue multiple.
  create table public.student_ijazah_progress (
    id uuid primary key default gen_random_uuid(),
    student_id uuid not null references public.profiles(id),
    pathway_id uuid not null references public.ijazah_pathways(id),
    enrolled_at timestamptz not null default now(),
    target_completion_at timestamptz,
    completed_at timestamptz,
    issuing_teacher_id uuid references public.profiles(id),
    issued_certificate_url text,
    unique (student_id, pathway_id)
  );

  -- Per-requirement progress: which requirements has the student met?
  create table public.student_ijazah_requirement_progress (
    id uuid primary key default gen_random_uuid(),
    student_progress_id uuid not null references public.student_ijazah_progress(id) on delete cascade,
    requirement_id uuid not null references public.ijazah_requirements(id),
    met_at timestamptz,
    verifying_teacher_id uuid references public.profiles(id),
    notes text,
    unique (student_progress_id, requirement_id)
  );
  ```
- **RLS.** Students read their own enrolment + requirement progress. Teachers read enrolments where they are `issuing_teacher_id` OR have ever taught the student. Admin/mod full access. Pathways + requirements are publicly readable (so prospective students can see what's offered).
- **UI.** New page `/student/ijazah` — landing for enrolled students, otherwise shows available pathways. Each enrolled pathway shows the requirements list with met/unmet markers and a current-completion percentage.
- **Teacher endorsement flow.** A "Mark requirement met" button on the teacher's view of the student. Writes to `student_ijazah_requirement_progress` with the verifying teacher's ID — the chain-of-transmission begins here.
- **Final certification.** When all requirements are met, an admin (and the issuing teacher) get a "ready to issue" notification. Issuance writes `student_ijazah_progress.completed_at` + `issuing_teacher_id` + uploads a PDF certificate (the chain to existing `teacher_ijaza` for the teacher's own ijazah optionally appears on the certificate as the chain).

**Brand fit.** ✅ Authentic. Ijazah is the apex of the classical Quran-teaching tradition. Doing this well differentiates the platform from any generic LMS.

**Build estimate.** ~4 weeks (schema + UI + endorsement flow + certificate generation).

**Blocked on.** Product input. Three concrete questions before any code:
1. **What pathways does the academy actually offer?** Even one is enough to ship; the table supports many.
2. **Which requirements are auto-derived (from `bookings` count, `session_evaluations` scores, `student_progress` surah coverage) vs. teacher-attested?** The simplest first version makes everything teacher-attested; auto-derivation can come later.
3. **Certificate aesthetics.** Calligraphy-rich PDF? Plain digital certificate? Physical mailed certificate? The platform's brand demands the first; cost demands the second.

---

## #15 (rest) — Parent + teacher timeline expansion

**What's already built.** Student-side `/student/timeline` (commit `467adc0`) — chronological feed of last 90 days from the student's perspective.

**What's left.** The same timeline visible to:
- **The parent** (when the student is a child or has parent involvement). Read-only. Optional ability to leave a comment ("good job today, son!") that the student sees.
- **The teacher.** Read-only view of the student's full timeline, useful when prepping for a session that's far in the future or after a long gap.

**Architecture sketch.**
- **Parent profile elevation.** Today, parents are not first-class users (the platform stores `parent_email` and `parent_phone` on `profiles` for outbound notifications, but parents have no login). To give parents a timeline view we need either:
  - **Option A (lightweight).** Magic-link tokenised access. The parent receives an email with a tokenised URL `furqan.today/parent/student/{student_id}/timeline?token=...`. Server-side token validation; no parent account creation. Simpler; lower commitment.
  - **Option B (full parent role).** Add `parent` as a `user_role` enum value, extend `profiles` to support parent-of relationships, build a parent dashboard. Higher cost; enables future parent features (follow-up feedback, communication).
  - **Recommendation:** Start with Option A. Migrate to Option B if/when parents express need for richer interaction.
- **Teacher view.** Reuses the student-side query. New route `/teacher/students/{studentId}/timeline`. RLS gates — teacher sees the timeline only if they have ever had a `bookings` row with this student.
- **Comments on timeline events.** New table `timeline_comments` (event_id polymorphic, author_id, body_text, created_at). Parents and teachers can comment; students see comments inline on their timeline.

**Code paths to touch.**
- `src/app/parent/student/[studentId]/timeline/page.tsx` — magic-link gated parent view (option A).
- `src/app/teacher/students/[studentId]/timeline/page.tsx` — teacher view of student timeline.
- `src/app/student/timeline/page.tsx` — extend to show comments inline.
- `src/lib/actions/timeline-comments.ts` — server action to create comments.
- New migration for `timeline_comments`.

**Brand fit.** ✅ All three roles see the same chronological reality, dignified, no gamification.

**Build estimate.** ~4 weeks (parent magic-link auth flow + teacher view + comments + RLS).

---

## #16 — AI tajweed correction in real time (strategic bet)

**What it is.** During a recorded recitation (from item #9 audio submission, or a Talqeen-mode live session, or item #13 archive), an AI model classifies tajweed errors automatically — flags potential madd/ghunna/makharij issues with timestamps. Surfaces to the teacher as a suggested-correction queue; the teacher confirms/rejects.

**Why this is strategic.** Quran tajweed correction is a niche audio classification problem. Generic ASR models (Whisper, AssemblyAI) get the words right but cannot judge whether a madd is the correct length or whether ghunna is being applied where required. A tajweed-aware model becomes a defensible moat: no general LMS competitor can build this; few Quran competitors have the data or willingness to invest.

**Two paths.**
- **Build.** Fine-tune Whisper-large or a Wav2Vec2 variant on tajweed-labelled audio. Requires 100s of hours of expert-annotated audio. Capital-intensive.
- **License.** Tarteel.ai has a tajweed correction model. Talk to them about API access. Cheaper to start; less defensible long-term.

**Why this matters even at design stage.** Items #9 and #13 (audio submission + archive) are building the data corpus that #16 ultimately consumes. If the academy ever decides to invest in #16, the audio archive will be the training set. Worth knowing this when sizing storage retention and audio quality decisions today.

---

## #17 — Halaqa group sessions (strategic bet)

**What it is.** Multi-student sessions in the traditional `halaqa` format: 4-8 students, one teacher, group recitation, individual correction rotations. The platform's `session_observers` table is a half-step toward this; full halaqa support needs group lifecycle, group follow-up, group evaluation, group dynamics.

**Why this matters.** A halaqa is the classical setting in which most Muslim students first learn to recite. Replicating it digitally unlocks (a) a price point lower than 1:1 sessions, (b) a social bond that 1:1 cannot, and (c) the Islamic concept of `jama'ah` — group learning is itself a religious value.

**Architecture sketch.**
- Extend `bookings` to support `is_group` (already exists) and `capacity` (already exists per the live audit reading).
- New table `group_session_enrollments` linking students to a group session — separate from individual bookings.
- Daily.co room with higher participant cap (currently 3; halaqa needs 8-10).
- Group homework: one homework_assignment per student, but assigned in a batch from a single teacher action.
- Rotation logic: in-session UI showing "now reciting: [student name]" so students wait their turn gracefully.

**Build estimate.** ~6 weeks.

---

## #18 — Teacher mentorship / coaching (strategic bet)

**What it is.** Senior teachers mentor junior teachers. A junior teacher sees a senior teacher's session evaluations (read-only) for the same student; observes (read-only via `session_observers`) selected sessions; gets feedback on their own teaching from the senior.

**Why this matters.** Teacher quality compounds student outcomes. The platform's `session_observers` table already exists for this exact purpose. The missing pieces: a teacher-mentor relationship model, a UI surface for the junior teacher to request mentorship, and an evaluation surface where the senior writes feedback to the junior (separate from student evaluations).

**Architecture sketch.**
- New table `teacher_mentorships` (mentor_id, mentee_id, started_at, ended_at, status).
- New table `teacher_mentorship_feedback` (mentorship_id, session_id, feedback_text, severity, created_at).
- Teacher dashboard surface: "My mentor" card for mentees, "My mentees" card for mentors.
- Reuses existing `session_observers` for the observation flow.

**Build estimate.** ~3 weeks.

---

## Build sequencing recommendation

If the next sprint chooses one item from this doc, **#11 Talqeen mode** has the highest pedagogical ROI — it transforms the live session from "video call" into "structured Quran teaching session", and uses Quranic imagery as the anchor (mushaf), reinforcing brand authenticity.

If the next sprint chooses one item that **doesn't depend on external blockers** (no AI key, no licensing question, no product input):
- **#15 (rest) parent + teacher timeline expansion** — uses the data already there, extends what just shipped. Magic-link option keeps it simple.

If the next sprint is **research-only**:
- **#16 conversation with Tarteel.ai** to scope licensing vs. build for tajweed correction. Even hearing "no" closes a strategic question.

## What this doc IS NOT

- Not a project plan. No dates, no people, no commitments.
- Not a product spec. The product owner still decides what ships and when.
- Not a contract for these features. Anything here can be deferred indefinitely or replaced as the platform learns.
- An honest design sketch from one engineering session, written so the next session can pick up without re-deriving the architecture.
