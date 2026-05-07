# FURQAN — Session Modes Migration & UI Excellence Plan

## A staged runbook with CLI-driven testing and visual walk-throughs

**Version:** 1.0 **Owner:** Dr. DEEB (drdeebtech) **Project:** furqan.today — Online Quran Academy **Mission:** Evolve from 1:1-only sessions to support **Private**, **Halaqa** (small group), and **Majlis/Lecture** modes — without breaking the live academy — and use the parallel time to elevate the dashboard and marketing site UI to production-grade polish.

---

## Quick start (read this first)

This plan runs **two tracks in parallel**:

**Track A — Backend migration** (sequential, 7 stages) Stage 1 → Schema → Stage 2 → Backend Logic → Stage 3 → Pricing scaffolding → Stage 4 → Dashboard awareness → Stage 5 → Halaqa booking → Stage 6 → Halaqa video UI → Stage 7 → Lecture (conditional)

**Track B — UI excellence pass** (runs alongside Track A Stages 1–3, since those don't change UI) Phase B1 → Marketing site polish → Phase B2 → Dashboard liquid glass corrective pass → Phase B3 → Component-library consolidation

**Each Track A stage has 4 gates:**

1. **Pre-flight Audit** (Claude Code reads code, produces audit doc)  
2. **Implementation** (Claude Code writes code on a feature branch)  
3. **Automated Verification** (CLI runbook — Supabase \+ Vercel \+ Playwright \+ curl)  
4. **Visual Walk** (Claude in Chrome on the preview URL)

**Each Track B phase has 3 gates:** Visual audit → Implementation → Visual verification.

**Branch \+ PR per stage.** Each stage has a unique Supabase branch DB and Vercel preview URL. Merge only when all gates pass.

---

## Universal rules (apply everywhere)

1. **Live site protection.** furqan.today is in production. Existing private sessions, bookings, dashboards, and the public 7-page site MUST work identically after every merge.  
2. **Branch isolation.** No work on `main`. Each stage and phase has its own branch and PR.  
3. **No data migration of existing rows.** Add new tables/columns. Existing private sessions get a default `session_type='private'` via column default. Don't UPDATE live data.  
4. **Real bilingual content only.** No invented Arabic. Reference `docs/content-inventory.md`. If a string is needed and not there, ask before adding.  
5. **Preserve design system.** Gold `#B8922D` only on interactive elements. Dark `#0a0a0a` background. RTL-first. `.impeccable.md` is canonical.  
6. **Two-query Supabase pattern.** No embedded selects like `profiles(*)`. Use `Promise.all` for parallelism. `as never` cast for inserts.  
7. **Enum safety.** `ALTER TYPE ... ADD VALUE` runs in a separate execution from any SQL using the new value (the 3-step pattern).  
8. **n8n MCP bug workaround.** Generate workflow JSON files for manual import. Never call `n8n:create_workflow_from_code`.  
9. **Centralized contact info.** All contact references go through `src/lib/contact.ts`. Never hardcode.  
10. **Document as you go.** Each stage produces `docs/migrations/STAGE_N_NOTES.md` with decisions, schema diffs, known issues.  
11. **Sessions schema quirk reminder.** The `sessions` table uses `booking_id` as foreign key, not direct `teacher_id`/`student_id`. Don't forget when writing RLS.  
12. **Stripe out of scope for this migration.** Pricing scaffolding goes in DB, but no Stripe API changes. We'll wire Stripe in a later dedicated phase.

---

## One-time environment setup (do this before Stage 1\)

Before starting any stage, set up the tooling. **This is a one-time investment of \~1 hour** that pays back across every stage.

### 0.1 Verify CLIs are authenticated

Open a terminal in the FURQAN repo root and run:

\# Verify everything is installed and authenticated

supabase \--version          \# Should show v1.x or v2.x

gh \--version                \# Should show v2.x

gh auth status              \# Should say "Logged in to github.com"

npx vercel \--version        \# Should show v32.x or higher

npx vercel whoami           \# Should show your Vercel username

npx playwright \--version    \# If not installed: npx playwright install

\# Daily.co — no CLI; we use curl with API key

curl \-s \-X GET "https://api.daily.co/v1/" \-H "Authorization: Bearer $DAILY\_API\_KEY" | head \-20

If any of these fail, fix that first. Don't proceed until all five tools answer cleanly.

### 0.2 Link Supabase project locally

supabase link \--project-ref xyqscjnqfeusgrhmwjts

\# Will prompt for DB password — use the one in your password manager

supabase db pull            \# Pulls current schema into supabase/migrations/

This gives you a local mirror of production schema as a baseline.

### 0.3 Enable Supabase Branching

Branching is what makes Option A safe. Each stage gets its own database branch.

\# Verify branching is enabled in your Supabase project

supabase branches list

\# If empty, that's fine — we'll create branches per stage

If branching is not on your plan tier, upgrade or fall back to Option B (local-only testing). Branching costs roughly $10/month per active branch — close branches when stages merge to avoid waste.

### 0.4 Create the runbook directory

mkdir \-p docs/migrations

mkdir \-p docs/migrations/runbooks

mkdir \-p docs/migrations/visual-walks

mkdir \-p tests/migrations

mkdir \-p tests/playwright/migrations

### 0.5 Install Playwright in the project

npm install \-D @playwright/test

npx playwright install chromium

Add a `playwright.config.ts` if you don't have one. Sample config goes in this plan in §Testing Infrastructure.

### 0.6 Create the master runbook helper script

Save this as `scripts/migration-helper.sh` and `chmod +x` it:

\#\!/usr/bin/env bash

\# FURQAN migration helper. Source this in each stage runbook.

set \-euo pipefail

PROJECT\_REF="xyqscjnqfeusgrhmwjts"

MAIN\_DOMAIN="furqan.today"

\# Create a new Supabase branch for the current stage

create\_branch() {

  local branch\_name="$1"

  echo "Creating Supabase branch: $branch\_name"

  supabase branches create "$branch\_name" \--persistent=false

  supabase branches get "$branch\_name"

}

\# Get the connection string for the current branch

get\_branch\_db\_url() {

  local branch\_name="$1"

  supabase branches get "$branch\_name" \--output json | jq \-r '.db\_url'

}

\# Deploy current branch to a Vercel preview

deploy\_preview() {

  local stage="$1"

  echo "Deploying preview for $stage..."

  npx vercel \--yes \--prod=false 2\>&1 | tee /tmp/vercel-deploy-$stage.log

  grep \-oE 'https://\[a-z0-9-\]+\\.vercel\\.app' /tmp/vercel-deploy-$stage.log | tail \-1

}

\# Fetch runtime logs from Vercel

get\_preview\_logs() {

  local preview\_url="$1"

  npx vercel logs "$preview\_url" \--since=1h

}

\# Verify Daily.co room properties

verify\_daily\_room() {

  local room\_url="$1"

  local room\_name=$(echo "$room\_url" | grep \-oE '\[^/\]+$')

  curl \-s \-X GET "https://api.daily.co/v1/rooms/$room\_name" \\

    \-H "Authorization: Bearer $DAILY\_API\_KEY" | jq '.properties'

}

\# Smoke test a deployment

smoke\_test\_preview() {

  local preview\_url="$1"

  echo "Smoke testing $preview\_url"

  for path in "/" "/about" "/services" "/packages" "/teachers" "/blog" "/contact"; do

    status=$(curl \-s \-o /dev/null \-w "%{http\_code}" "$preview\_url$path")

    echo "$path → HTTP $status"

    \[\[ "$status" \== "200" \]\] || echo "  ⚠️  WARNING: non-200"

  done

}

export \-f create\_branch get\_branch\_db\_url deploy\_preview get\_preview\_logs verify\_daily\_room smoke\_test\_preview

Now you can `source scripts/migration-helper.sh` in any runbook.

### 0.7 Capture a pre-migration snapshot

Critical: take a baseline snapshot of production state. This is the "ground truth" we compare against.

\# Schema baseline

supabase db dump \--schema-only \> docs/migrations/baseline-schema.sql

\# Data row counts (for regression checks)

supabase db execute \--linked \<\<'SQL' \> docs/migrations/baseline-counts.txt

SELECT 'profiles' as table, count(\*) FROM profiles

UNION ALL SELECT 'sessions', count(\*) FROM sessions

UNION ALL SELECT 'bookings', count(\*) FROM bookings

UNION ALL SELECT 'packages', count(\*) FROM packages;

SQL

\# RLS policy baseline

supabase db execute \--linked \<\<'SQL' \> docs/migrations/baseline-rls.txt

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual

FROM pg\_policies

ORDER BY schemaname, tablename, policyname;

SQL

\# Sample Daily room properties (pick a recent session)

RECENT\_ROOM=$(supabase db execute \--linked \--output json \<\<'SQL' | jq \-r '.\[0\].daily\_room\_url'

SELECT daily\_room\_url FROM sessions

WHERE daily\_room\_url IS NOT NULL

ORDER BY created\_at DESC LIMIT 1;

SQL

)

verify\_daily\_room "$RECENT\_ROOM" \> docs/migrations/baseline-daily-room.json

\# Commit the baseline

git checkout \-b chore/migration-baseline

git add docs/migrations/baseline-\*

git commit \-m "chore: capture pre-migration baseline state"

gh pr create \--title "Migration baseline snapshot" \--body "Pre-migration ground truth" \--base main

gh pr merge \--squash \--delete-branch

You now have a frozen reference point. If anything breaks during migration, you can compare current state vs baseline and find the diff.

---

## Testing infrastructure (one-time setup)

### Playwright config

`playwright.config.ts`:

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({

  testDir: './tests/playwright',

  timeout: 30\_000,

  retries: 1,

  reporter: \[\['html', { outputFolder: 'tests/playwright-report' }\]\],

  use: {

    baseURL: process.env.PREVIEW\_URL || 'http://localhost:3000',

    trace: 'on-first-retry',

    screenshot: 'only-on-failure',

  },

  projects: \[

    { name: 'chromium', use: { ...devices\['Desktop Chrome'\] } },

    { name: 'mobile-chrome', use: { ...devices\['Pixel 7'\] } },

  \],

});

### Regression test scaffold

`tests/playwright/migrations/regression.spec.ts`:

import { test, expect } from '@playwright/test';

const PUBLIC\_PAGES \= \['/', '/about', '/services', '/packages', '/teachers', '/blog', '/contact'\];

test.describe('Public site regression', () \=\> {

  for (const path of PUBLIC\_PAGES) {

    test(\`${path} loads without errors\`, async ({ page }) \=\> {

      const errors: string\[\] \= \[\];

      page.on('pageerror', e \=\> errors.push(e.message));

      page.on('console', m \=\> { if (m.type() \=== 'error') errors.push(m.text()); });

      const response \= await page.goto(path);

      expect(response?.status()).toBe(200);

      await page.waitForLoadState('networkidle');

      expect(errors).toEqual(\[\]);

    });

  }

});

You'll add stage-specific specs as we go.

---

# TRACK A — Session Modes Migration

# STAGE 1 — Schema Foundation

**Goal:** Add the data structures for three session modes. Zero behavior change. Existing platform works identically.

**Branch:** `feat/sessions-stage-1-schema` **Supabase branch:** `stage-1-schema` **Estimated time:** 4–6 hours

---

## Stage 1 — Gate 1: Pre-flight Audit

\# Set up the stage environment

git checkout main && git pull

git checkout \-b feat/sessions-stage-1-schema

source scripts/migration-helper.sh

create\_branch "stage-1-schema"

**Paste this into Claude Code:**

You are auditing the FURQAN codebase before a Stage 1 schema migration.

DO NOT change any code. Produce only an audit report.

Save the report at: docs/migrations/STAGE\_1\_AUDIT.md

Required sections:

1\. SESSIONS TABLE INVENTORY

   \- List every column in the current \`sessions\` table (read from supabase/migrations/ and Supabase types)

   \- List every table that has a foreign key referencing sessions

   \- List every TypeScript type/interface that references sessions or imports from supabase types

2\. BOOKING-SESSION RELATIONSHIP MAP

   \- Document the current bookings.id → sessions.booking\_id relationship

   \- List every query in src/ that joins bookings and sessions (use grep)

   \- Flag any query that assumes 1:1 cardinality

3\. RLS POLICY INVENTORY

   \- Read docs/migrations/baseline-rls.txt

   \- For each policy on sessions, bookings, profiles: write what it grants in plain English

   \- Flag policies that will need updating for multi-participant sessions

4\. DAILY.CO ROOM CREATION FLOW

   \- Locate every place a Daily room is created (server actions, API routes, n8n workflow JSONs)

   \- Document the room properties currently set

   \- Flag any hardcoded \`max\_participants: 2\` or 1:1 assumption

5\. PRICING / PACKAGES TOUCHPOINTS

   \- Document how packages currently map to session counts

   \- Flag any logic assuming 1 session \= 1 student

6\. CONFLICT MATRIX

   \- List every place the new schema could conflict with existing code

   \- Rate each: LOW / MEDIUM / HIGH risk

   \- Propose a mitigation for HIGH-risk items

7\. STAGE 1 IMPLEMENTATION PRECONDITIONS

   \- List anything that must be true before implementation can start safely

End with: "Audit complete. Ready for Stage 1 implementation." or "Audit found blocking issues — see section X."

**Human gate:** Read the audit. If anything surprises you, discuss with Claude in chat before proceeding.

---

## Stage 1 — Gate 2: Implementation

**Paste into Claude Code:**

Implement Stage 1 of the FURQAN session modes migration.

Reference: docs/migrations/STAGE\_1\_AUDIT.md

Branch: feat/sessions-stage-1-schema (already checked out)

Scope — do exactly this, nothing more:

1\. CREATE MIGRATION FILE

   Path: supabase/migrations/\[timestamp\]\_session\_modes\_foundation.sql

   

   Use the 3-step enum-safe pattern. Each step in a separate execution block (-- STEP N comments).

   STEP 1 — Create enums:

     CREATE TYPE session\_type\_enum AS ENUM ('private', 'halaqa', 'lecture');

     CREATE TYPE participant\_role\_enum AS ENUM ('teacher', 'student', 'observer');

     CREATE TYPE attendance\_status\_enum AS ENUM ('registered', 'attended', 'absent', 'late', 'left\_early');

   STEP 2 — Extend sessions table:

     ALTER TABLE sessions ADD COLUMN session\_type session\_type\_enum NOT NULL DEFAULT 'private';

     ALTER TABLE sessions ADD COLUMN max\_participants INT NOT NULL DEFAULT 2;

     ALTER TABLE sessions ADD COLUMN min\_participants INT NOT NULL DEFAULT 1;

     ALTER TABLE sessions ADD COLUMN current\_enrollment INT NOT NULL DEFAULT 0;

     ALTER TABLE sessions ADD COLUMN allow\_recording BOOLEAN NOT NULL DEFAULT false;

     ALTER TABLE sessions ADD COLUMN surah\_reference TEXT;

     ALTER TABLE sessions ADD COLUMN ayah\_range TEXT;

     ALTER TABLE sessions ADD COLUMN session\_topic\_ar TEXT;

     ALTER TABLE sessions ADD COLUMN session\_topic\_en TEXT;

     ALTER TABLE sessions ADD COLUMN daily\_room\_mode TEXT NOT NULL DEFAULT 'default';

   STEP 3 — Create session\_participants table:

     CREATE TABLE session\_participants (

       id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),

       session\_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

       user\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

       role participant\_role\_enum NOT NULL,

       attendance\_status attendance\_status\_enum NOT NULL DEFAULT 'registered',

       joined\_at TIMESTAMPTZ,

       left\_at TIMESTAMPTZ,

       daily\_token TEXT,

       booking\_id UUID REFERENCES bookings(id) ON DELETE SET NULL,

       notes TEXT,

       created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

       updated\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

       UNIQUE(session\_id, user\_id)

     );

   STEP 4 — Indexes:

     CREATE INDEX idx\_session\_participants\_session ON session\_participants(session\_id);

     CREATE INDEX idx\_session\_participants\_user ON session\_participants(user\_id);

     CREATE INDEX idx\_session\_participants\_role ON session\_participants(role);

     CREATE INDEX idx\_sessions\_session\_type ON sessions(session\_type);

   STEP 5 — Backfill existing sessions:

     For every existing session, insert two session\_participants rows:

       \- One with role='teacher' (teacher\_id from the linked booking's teacher)

       \- One with role='student' (student\_id from the linked booking)

       \- attendance\_status \= 'attended' if session.scheduled\_at \< now(), else 'registered'

       \- booking\_id \= the original booking

     This must be INSERT-only. Do NOT UPDATE existing sessions or bookings rows.

   STEP 6 — Updated\_at trigger on session\_participants (use existing pattern from other tables).

   STEP 7 — RLS enabling (DO NOT add policies yet — Stage 2):

     ALTER TABLE session\_participants ENABLE ROW LEVEL SECURITY;

2\. REGENERATE TYPES

   Run: npx supabase gen types typescript \--linked \> src/types/database.types.ts

   (Or wherever the existing types file lives — match the existing convention)

3\. CREATE TYPE HELPERS

   Path: src/lib/sessions/types.ts

   

   \- Export type SessionType, ParticipantRole, AttendanceStatus from database types

   \- Export const MAX\_PARTICIPANTS\_BY\_TYPE: Record\<SessionType, number\> \= { private: 2, halaqa: 15, lecture: 500 }

   \- Export const DEFAULT\_ROOM\_MODE\_BY\_TYPE: Record\<SessionType, string\> \= { private: 'default', halaqa: 'group', lecture: 'broadcast' }

   \- Export helpers isPrivateSession, isHalaqaSession, isLectureSession

   \- Export getMaxParticipantsForType, getDefaultRoomModeForType

   \- All bilingual labels via t() pattern from useLang hook

4\. STAGE NOTES

   Path: docs/migrations/STAGE\_1\_NOTES.md

   \- Schema diff (paste output of \`supabase db diff\`)

   \- Backfill row count (run a SELECT count(\*) and paste)

   \- Any deviations from this prompt

   \- Known-issue list

DO NOT:

\- Touch any UI components, pages, or routes

\- Touch any RLS policies (Stage 2\)

\- Touch the Daily room creation logic (Stage 2\)

\- Touch pricing or Stripe (out of scope)

\- Touch dashboards (Stage 4\)

\- Build any new pages

\- Modify the public 7-page site or blog CMS

After completing:

\- Run: npm run build

\- Run: npx tsc \--noEmit

\- Report any errors. If errors exist, do not commit; fix them first.

Final commit message:

"feat(sessions): stage 1 — schema foundation for session modes

Adds session\_type enum, session\_participants table, and helper types.

Zero behavior change. Existing private sessions backfilled with participants.

Stage 1 of FURQAN session modes migration."

---

## Stage 1 — Gate 3: Automated Verification

Save as `docs/migrations/runbooks/stage-1-verify.sh`:

\#\!/usr/bin/env bash

\# Stage 1 verification runbook

set \-euo pipefail

source scripts/migration-helper.sh

echo "=== Stage 1 Verification \==="

\# 1\. Apply migration to the stage-1-schema branch DB

echo "\[1/8\] Pushing migration to stage-1-schema branch..."

supabase db push \--branch stage-1-schema

\# 2\. Schema health checks

echo "\[2/8\] Verifying schema state..."

supabase db execute \--branch stage-1-schema \<\<'SQL'

\-- Every session must have a non-null session\_type

SELECT 'session\_type\_nulls' as check, count(\*) as fail\_count

FROM sessions WHERE session\_type IS NULL;

\-- Every session should have exactly 2 participants after backfill

SELECT 'sessions\_without\_2\_participants' as check, count(\*) as fail\_count

FROM sessions s

WHERE (SELECT count(\*) FROM session\_participants WHERE session\_id \= s.id) \!= 2;

\-- Total sessions vs total participant rows

SELECT 'total\_sessions' as metric, count(\*) as value FROM sessions

UNION ALL

SELECT 'total\_participants', count(\*) FROM session\_participants

UNION ALL

SELECT 'expected\_participants', count(\*) \* 2 FROM sessions;

SQL

\# 3\. TypeScript health

echo "\[3/8\] TypeScript check..."

npx tsc \--noEmit

\# 4\. Build check

echo "\[4/8\] Next.js build..."

npm run build

\# 5\. Lint

echo "\[5/8\] Lint check..."

npm run lint

\# 6\. Deploy preview

echo "\[6/8\] Deploying Vercel preview..."

PREVIEW\_URL=$(deploy\_preview "stage-1")

echo "Preview URL: $PREVIEW\_URL"

\# 7\. Smoke test public pages

echo "\[7/8\] Smoke testing public pages..."

smoke\_test\_preview "$PREVIEW\_URL"

\# 8\. Run Playwright regression suite

echo "\[8/8\] Playwright regression..."

PREVIEW\_URL="$PREVIEW\_URL" npx playwright test tests/playwright/migrations/regression.spec.ts

echo ""

echo "=== Stage 1 verification complete \==="

echo "Preview URL: $PREVIEW\_URL"

echo "Next: run the Stage 1 visual walk against this URL"

Run it:

chmod \+x docs/migrations/runbooks/stage-1-verify.sh

./docs/migrations/runbooks/stage-1-verify.sh

If any step fails, do NOT proceed. Fix and re-run.

---

## Stage 1 — Gate 4: Visual Walk (Claude in Chrome)

Open the Stage 1 preview URL in Chrome with the Claude extension active.

**Paste this prompt into Claude in Chrome:**

You are doing a visual regression walk of FURQAN after a backend schema migration.

The migration should NOT have changed any visible UI. Your job is to confirm visual parity with production.

Reference: production site at furqan.today (open in another tab if needed).

For each route, take a screenshot and compare to expected appearance:

PUBLIC SITE

  1\. / — homepage

  2\. /about

  3\. /services

  4\. /packages

  5\. /teachers

  6\. /blog

  7\. /contact

DASHBOARDS (use the test admin account dreldeeburo@gmail.com)

  8\. /admin/dashboard

  9\. /admin/sessions

  10\. /admin/teachers

  11\. /admin/students

  12\. /admin/services

  13\. /admin/packages

  14\. /admin/blog

TEACHER DASHBOARD (test teacher account)

  15\. /teacher/dashboard

  16\. /teacher/sessions

  17\. /teacher/students

STUDENT DASHBOARD (test student account)

  18\. /student/dashboard

  19\. /student/sessions

  20\. /student/teachers

For each route, report in a table:

| Route | Loaded? | Console errors? | Visual issues? | Pass/Fail |

End with one of:

  ✅ "Stage 1 visual walk PASSED — no regressions detected"

  ⚠️ "Stage 1 visual walk PASSED with cosmetic notes — see list"

  ❌ "Stage 1 visual walk FAILED — blocking issues, see list"

Save your report to: docs/migrations/visual-walks/stage-1-walk.md

**Human gate before merge:** All four gates pass. Then:

git push origin feat/sessions-stage-1-schema

gh pr create \\

  \--title "Stage 1: Schema foundation for session modes" \\

  \--body-file docs/migrations/STAGE\_1\_NOTES.md \\

  \--base main \\

  \--label "migration,stage-1"

\# Review PR diff one final time

gh pr diff

\# When satisfied:

gh pr merge \--squash \--delete-branch

\# Apply to production

supabase db push \--linked

\# Verify production health

./docs/migrations/runbooks/stage-1-verify.sh

\# Clean up the Supabase branch

supabase branches delete stage-1-schema

Stage 1 complete. ✅

---

# STAGE 2 — Backend Logic Layer

**Goal:** Make the backend session-type-aware. Daily room creation switches by type. RLS policies handle multi-participant sessions. Token generation per role. Existing private flow works identically (regression-tested).

**Branch:** `feat/sessions-stage-2-backend` **Supabase branch:** `stage-2-backend` **Estimated time:** 6–8 hours

---

## Stage 2 — Gate 1: Pre-flight Audit

git checkout main && git pull

git checkout \-b feat/sessions-stage-2-backend

source scripts/migration-helper.sh

create\_branch "stage-2-backend"

**Paste into Claude Code:**

Audit before Stage 2\. Save to docs/migrations/STAGE\_2\_AUDIT.md.

Required sections:

1\. CURRENT RLS POLICIES

   \- List every policy on sessions, session\_participants, bookings, profiles

   \- For each: what it grants, to whom, in plain English

2\. CURRENT ROOM CREATION CODE

   \- Find every function/route/action that creates a Daily room (grep for daily.co, api.daily.co, createRoom, etc.)

   \- Document file path, function name, parameters passed to Daily

   \- Where the room URL is stored after creation

3\. CURRENT TOKEN GENERATION

   \- Where Daily meeting tokens are issued

   \- Token properties currently set

   \- How role/permissions are determined

4\. ADMIN OBSERVATION FLOW

   \- Locate the admin "observe session" feature

   \- Document how it joins a session currently

5\. n8n CURRENT WORKFLOWS

   \- List the n8n workflow JSON files in repo root

   \- Identify which one creates Daily rooms

   \- Document the trigger and the Daily API call

6\. RISK MATRIX

   \- List every change Stage 2 will make

   \- Rate risk: LOW/MEDIUM/HIGH

   \- Mitigation for each HIGH

7\. PRECONDITIONS

   \- Anything that must be true to start Stage 2 safely

End: "Stage 2 audit complete." or "Stage 2 audit found blocking issues."

---

## Stage 2 — Gate 2: Implementation

**Paste into Claude Code:**

Implement Stage 2 of FURQAN session modes.

Reference: docs/migrations/STAGE\_2\_AUDIT.md

Branch: feat/sessions-stage-2-backend

Scope:

1\. RLS POLICIES MIGRATION

   Path: supabase/migrations/\[timestamp\]\_session\_modes\_rls.sql

   For session\_participants table:

     SELECT policy "participants\_read\_own\_or\_teaching":

       (auth.uid() \= user\_id) OR

       (EXISTS (SELECT 1 FROM sessions s JOIN bookings b ON s.booking\_id \= b.id 

                WHERE s.id \= session\_id AND b.teacher\_id \= auth.uid())) OR

       (EXISTS (SELECT 1 FROM profiles WHERE id \= auth.uid() AND role IN ('admin', 'moderator')))

     

     INSERT policy: service\_role only (no client inserts allowed)

     

     UPDATE policy "participants\_update\_own\_attendance":

       Users can update their own attendance\_status only

       Teachers can update any participant on their own sessions

       Admins can update anything

     

     DELETE policy: admin only

   For sessions table — add type-aware read access:

     \- Existing teacher/student read for private continues

     \- Add: enrolled session\_participants can read sessions where they appear

     \- Admin can read everything

2\. ROOM CREATION SERVICE

   Path: src/lib/sessions/room-creation.ts

   

   Export createSessionRoom(session: Session): Promise\<{ roomUrl: string; roomMode: string }\>

   

   Switch on session.session\_type:

   

     'private':

       max\_participants: 2

       enable\_chat: true

       start\_video\_off: false

       enable\_recording: session.allow\_recording ? 'cloud' : 'none'

       exp: scheduled\_at \+ 2 hours (expiry)

   

     'halaqa':

       max\_participants: Math.min(session.max\_participants, 25\)

       enable\_chat: true

       owner\_only\_broadcast: false

       enable\_recording: session.allow\_recording ? 'cloud' : 'none'

       enable\_knocking: true

       exp: scheduled\_at \+ 3 hours

   

     'lecture':

       max\_participants: Math.min(session.max\_participants, 500\)

       owner\_only\_broadcast: true

       start\_audio\_off: true

       enable\_chat: true

       enable\_hand\_raising: true

       enable\_recording: 'cloud'

       exp: scheduled\_at \+ 4 hours

   CRITICAL: For 'private' type, the resulting Daily room properties MUST EXACTLY MATCH the current production behavior. Reference docs/migrations/baseline-daily-room.json. This is a regression-tested guarantee.

3\. UPDATE ROOM CREATION CALL SITES

   \- Find every existing call site (per audit)

   \- Replace with createSessionRoom(session)

   \- Existing function signatures of server actions remain identical (internal implementation only changes)

4\. TOKEN GENERATION SERVICE

   Path: src/lib/sessions/token-generation.ts

   

   Export generateMeetingToken(sessionId: string, userId: string): Promise\<string\>

   

   Logic:

     \- Two-query pattern: fetch session, then session\_participants row for this user

     \- role='teacher' → is\_owner: true, can\_admin: true

     \- role='student' in 'private' or 'halaqa' → is\_owner: false, normal mic/camera

     \- role='student' in 'lecture' → is\_owner: false, start\_audio\_off: true, start\_video\_off: true, can\_send\_message: true

     \- role='observer' → is\_owner: false, start\_audio\_off: true, start\_video\_off: true, hidden\_from\_participant\_list: true

     \- Save token to session\_participants.daily\_token

     \- Token exp: session scheduled\_at \+ appropriate duration

5\. n8n WORKFLOW UPDATE

   Path: n8n-furqan-auto-create-daily-room-v2.json (manual import — DO NOT use n8n MCP create tool)

   

   Workflow structure:

     \- Trigger: Supabase webhook on sessions INSERT

     \- Read session\_type from payload

     \- Switch node on session\_type

     \- Three branches with appropriate Daily API calls

     \- Update sessions row with daily\_room\_url

     \- Add error handling node that logs failures to Supabase audit log

   

   Add manual import instructions to docs/migrations/STAGE\_2\_NOTES.md.

6\. ADMIN OBSERVATION SUPPORT

   \- When an admin clicks "observe session", server action creates a session\_participants row with role='observer' if one doesn't exist

   \- Issue hidden-mode token

   \- Existing admin observation UI continues to function

   \- Test that the existing 1:1 observation flow still works end-to-end

7\. SERVER ACTIONS REVIEW

   \- All actions called from form action= attributes maintain useActionState pattern

   \- All Supabase queries use two-query pattern, not embedded selects

   \- All inserts use \`as never\` cast

   \- Use Promise.all where parallelism applies

8\. STAGE NOTES

   docs/migrations/STAGE\_2\_NOTES.md:

     \- RLS policy diff

     \- Room property comparison table (private before vs after — must be identical)

     \- n8n import instructions

     \- Any deviations

     \- Known issues

DO NOT:

\- Build any new UI

\- Add booking flows for halaqa or lecture (Stage 5\)

\- Build group video page (Stage 6\)

\- Modify pricing (Stage 3\)

\- Touch dashboards beyond verifying they still load

After: npm run build, npx tsc \--noEmit, fix errors before commit.

Commit:

"feat(sessions): stage 2 — backend logic layer

Adds session-type-aware room creation, role-based tokens,

multi-participant RLS policies, and updated n8n workflow.

Private session flow regression-tested for parity.

Stage 2 of FURQAN session modes migration."

---

## Stage 2 — Gate 3: Automated Verification

Save as `docs/migrations/runbooks/stage-2-verify.sh`:

\#\!/usr/bin/env bash

set \-euo pipefail

source scripts/migration-helper.sh

echo "=== Stage 2 Verification \==="

\# 1\. Apply migration

echo "\[1/10\] Push to stage-2-backend branch..."

supabase db push \--branch stage-2-backend

\# 2\. RLS smoke tests

echo "\[2/10\] RLS policy tests..."

supabase db execute \--branch stage-2-backend \<\<'SQL'

\-- Confirm policies exist

SELECT tablename, policyname, cmd FROM pg\_policies

WHERE tablename IN ('sessions', 'session\_participants')

ORDER BY tablename, policyname;

SQL

\# 3\. Private session regression — create a private session, verify Daily room matches baseline

echo "\[3/10\] Private session regression test..."

node tests/migrations/private-session-regression.mjs

\# 4\. Token generation unit tests

echo "\[4/10\] Token generation tests..."

npx vitest run src/lib/sessions/\_\_tests\_\_/

\# 5\. Build \+ types

echo "\[5/10\] Build and type check..."

npm run build

npx tsc \--noEmit

\# 6\. Deploy preview

echo "\[6/10\] Deploy preview..."

PREVIEW\_URL=$(deploy\_preview "stage-2")

\# 7\. n8n workflow dry-run

echo "\[7/10\] n8n workflow dry-run..."

echo "MANUAL: import n8n-furqan-auto-create-daily-room-v2.json in n8n.drdeeb.tech"

echo "MANUAL: trigger with test payloads (private/halaqa/lecture)"

echo "MANUAL: confirm rooms created with correct properties"

read \-p "n8n test passed? (y/n): " n8n\_ok

\[\[ "$n8n\_ok" \== "y" \]\] || exit 1

\# 8\. Smoke test

echo "\[8/10\] Smoke test..."

smoke\_test\_preview "$PREVIEW\_URL"

\# 9\. Playwright regression

echo "\[9/10\] Playwright regression..."

PREVIEW\_URL="$PREVIEW\_URL" npx playwright test tests/playwright/migrations/

\# 10\. Vercel runtime logs check

echo "\[10/10\] Checking runtime logs for errors..."

get\_preview\_logs "$PREVIEW\_URL" | grep \-i error | head \-20 || echo "No errors found"

echo "=== Stage 2 verification complete \==="

echo "Preview URL: $PREVIEW\_URL"

`tests/migrations/private-session-regression.mjs`:

// Verify a private session's Daily room properties match the baseline exactly.

import fs from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const supabase \= createClient(

  process.env.NEXT\_PUBLIC\_SUPABASE\_URL,

  process.env.SUPABASE\_SERVICE\_ROLE\_KEY

);

const baseline \= JSON.parse(

  fs.readFileSync('docs/migrations/baseline-daily-room.json', 'utf8')

);

// Create a fresh test private session

const { data: session } \= await supabase

  .from('sessions')

  .insert({ session\_type: 'private', /\* ... \*/ })

  .select()

  .single();

// Wait for n8n to create room

await new Promise(r \=\> setTimeout(r, 5000));

const { data: updated } \= await supabase

  .from('sessions')

  .select('daily\_room\_url')

  .eq('id', session.id)

  .single();

// Fetch room properties from Daily

const roomName \= updated.daily\_room\_url.split('/').pop();

const res \= await fetch(\`https://api.daily.co/v1/rooms/${roomName}\`, {

  headers: { Authorization: \`Bearer ${process.env.DAILY\_API\_KEY}\` }

});

const props \= (await res.json()).properties;

// Compare critical fields

const fieldsToCheck \= \['max\_participants', 'enable\_chat', 'start\_video\_off'\];

let mismatches \= \[\];

for (const f of fieldsToCheck) {

  if (props\[f\] \!== baseline\[f\]) {

    mismatches.push(\`${f}: baseline=${baseline\[f\]} new=${props\[f\]}\`);

  }

}

if (mismatches.length) {

  console.error('REGRESSION:', mismatches);

  process.exit(1);

}

console.log('Private session room properties match baseline ✓');

// Cleanup

await supabase.from('sessions').delete().eq('id', session.id);

---

## Stage 2 — Gate 4: Visual Walk (Claude in Chrome)

Visual walk for Stage 2\. Backend logic changed; UI should look unchanged but functionality must still work end-to-end.

LIVE FUNCTIONAL WALK:

1\. Log in as admin → /admin/sessions → click "Create new session"

   \- Confirm form loads

   \- Create a private session for test teacher \+ test student

   \- Confirm session appears in list with daily\_room\_url populated within 30 seconds

2\. Open a second browser/incognito → log in as the test teacher

   \- Navigate to teacher dashboard

   \- Find the session, click "Join"

   \- Confirm video call loads, camera/mic work

   \- Confirm you appear as the host (mute-all controls visible)

3\. Third window → log in as test student

   \- Find the session, join

   \- Confirm both faces appear

   \- Confirm you DO NOT have mute-all controls (you're not host)

4\. Fourth window → log in as admin → click "Observe" on the active session

   \- Confirm you join as a hidden observer

   \- Confirm teacher and student do NOT see you in their participant list

   \- Confirm you can see and hear them

5\. End the session

   \- Confirm session status updates correctly

   \- Confirm session\_participants attendance\_status updates

For each step: screenshot \+ console errors \+ pass/fail.

Save report to: docs/migrations/visual-walks/stage-2-walk.md

End with:

  ✅ "Stage 2 visual walk PASSED"

  ⚠️ "Stage 2 visual walk PASSED with notes"

  ❌ "Stage 2 visual walk FAILED"

**Human gate:** All four gates pass.

git push origin feat/sessions-stage-2-backend

gh pr create \--title "Stage 2: Backend logic for session modes" \\

  \--body-file docs/migrations/STAGE\_2\_NOTES.md \--base main \--label "migration,stage-2"

gh pr diff

gh pr merge \--squash \--delete-branch

supabase db push \--linked

./docs/migrations/runbooks/stage-2-verify.sh

supabase branches delete stage-2-backend

Stage 2 complete. ✅

---

(Continued in Part 2 — Stages 3-7 and Track B UI Excellence Pass)

# FURQAN Session Modes Migration — Part 2

## Stages 3–7 (Track A continued)

---

# STAGE 3 — Pricing & Packages Foundation

**Goal:** Extend the pricing data model to know about session types. No Stripe API changes (out of scope per your direction). Existing private packages continue charging exactly the same. Foundation for halaqa pricing lands in DB only.

**Branch:** `feat/sessions-stage-3-pricing` **Supabase branch:** `stage-3-pricing` **Estimated time:** 4–5 hours

---

## Stage 3 — Gate 1: Pre-flight Audit

git checkout main && git pull

git checkout \-b feat/sessions-stage-3-pricing

source scripts/migration-helper.sh

create\_branch "stage-3-pricing"

**Paste into Claude Code:**

Audit before Stage 3\. Save to docs/migrations/STAGE\_3\_AUDIT.md.

NOTE: Stripe is OUT OF SCOPE. We are scaffolding the data model only.

Required sections:

1\. PACKAGES TABLE — current schema, all columns, with sample data

2\. PURCHASE FLOW — trace how a student currently gets sessions credited (DB writes, no Stripe)

3\. SESSION ALLOWANCE TRACKING — how is "student has X sessions left" tracked?

4\. TEACHER PAYOUT LOGIC — if any exists, document

5\. ADMIN PACKAGE EDITOR — current /admin/packages UI; what fields, what actions

6\. RISKS for adding session\_type-aware allowances

7\. PRECONDITIONS for Stage 3

End: "Stage 3 audit complete." or "Stage 3 audit found blocking issues."

---

## Stage 3 — Gate 2: Implementation

**Paste into Claude Code:**

Implement Stage 3 of FURQAN session modes.

Reference: docs/migrations/STAGE\_3\_AUDIT.md

Branch: feat/sessions-stage-3-pricing

NOTE: Stripe is OUT OF SCOPE. Data model only.

Scope:

1\. SCHEMA EXTENSION

   Path: supabase/migrations/\[timestamp\]\_session\_modes\_pricing.sql

   

   ALTER TABLE packages

     ADD COLUMN session\_type\_allowances JSONB NOT NULL DEFAULT '{"private": 0, "halaqa": 0, "lecture": 0}'::jsonb;

   ALTER TABLE packages

     ADD COLUMN supports\_session\_types session\_type\_enum\[\] NOT NULL DEFAULT ARRAY\['private'\]::session\_type\_enum\[\];

   ALTER TABLE packages

     ADD COLUMN halaqa\_pricing\_tiers JSONB DEFAULT '\[\]'::jsonb;

   

   For all existing packages, set:

     session\_type\_allowances \= jsonb\_build\_object('private', \<existing session\_count\>, 'halaqa', 0, 'lecture', 0\)

   This is a one-time UPDATE for existing rows only.

2\. STUDENT ALLOWANCE TRACKING

   New table:

     CREATE TABLE student\_session\_allowances (

       id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),

       student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

       package\_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,

       session\_type session\_type\_enum NOT NULL,

       total\_allowance INT NOT NULL,

       used INT NOT NULL DEFAULT 0,

       remaining INT GENERATED ALWAYS AS (total\_allowance \- used) STORED,

       expires\_at TIMESTAMPTZ,

       created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

       updated\_at TIMESTAMPTZ NOT NULL DEFAULT now()

     );

     CREATE INDEX idx\_allowances\_student ON student\_session\_allowances(student\_id);

     CREATE INDEX idx\_allowances\_remaining ON student\_session\_allowances(student\_id, session\_type) WHERE remaining \> 0;

   Backfill: for every existing student-package relationship, create an allowance row for 'private' with their existing session\_count.

3\. PRICING HELPERS

   Path: src/lib/pricing/session-types.ts

   

   \- getRemainingAllowance(studentId, sessionType): Promise\<number\>

   \- canBookSessionType(studentId, sessionType): Promise\<boolean\>

   \- decrementAllowance(studentId, sessionType): Promise\<void\>  \-- atomic via Postgres function

   \- getStudentPackageStatus(studentId): Promise\<PackageStatus\>

   

   Use two-query Supabase pattern. No embedded selects.

4\. ATOMIC DECREMENT FUNCTION

   In the migration:

     CREATE OR REPLACE FUNCTION decrement\_student\_allowance(

       p\_student\_id UUID,

       p\_session\_type session\_type\_enum

     ) RETURNS BOOLEAN

     LANGUAGE plpgsql

     AS $$ ... atomic update with row lock ... $$;

   

   Returns true if decremented, false if no allowance available.

5\. ADMIN PACKAGE EDITOR EXTENSION

   Extend the existing /admin/packages form (do NOT redesign it):

   \- Add section "Session Type Allowances" with three number inputs (Private/Halaqa/Lecture)

   \- Saves to session\_type\_allowances JSONB

   \- Preserve existing form layout, just add this section near the bottom

   \- Bilingual labels via t() pattern

   \- Use existing useActionState pattern for the form action

6\. RLS for student\_session\_allowances

   \- SELECT: student can see own; teacher can see their students'; admin sees all

   \- INSERT/UPDATE: service\_role only

7\. STAGE NOTES

   docs/migrations/STAGE\_3\_NOTES.md

DO NOT:

\- Touch Stripe (out of scope this migration)

\- Build halaqa booking flow (Stage 5\)

\- Modify checkout pages (out of scope)

\- Build any new student-facing pricing UI

After: build, types, fix errors before commit.

Commit:

"feat(sessions): stage 3 — pricing and allowance scaffolding

Adds session\_type\_allowances on packages, student\_session\_allowances

table for atomic tracking, and admin package editor extension.

No Stripe changes. Existing private allowance backfilled.

Stage 3 of FURQAN session modes migration."

---

## Stage 3 — Gate 3: Automated Verification

`docs/migrations/runbooks/stage-3-verify.sh`:

\#\!/usr/bin/env bash

set \-euo pipefail

source scripts/migration-helper.sh

echo "=== Stage 3 Verification \==="

supabase db push \--branch stage-3-pricing

echo "\[1/8\] Schema checks..."

supabase db execute \--branch stage-3-pricing \<\<'SQL'

\-- Every package has session\_type\_allowances

SELECT count(\*) FROM packages WHERE session\_type\_allowances IS NULL;

\-- Every student with a private package has an allowance row

SELECT count(\*) FROM student\_session\_allowances WHERE session\_type \= 'private';

\-- No negative remaining

SELECT count(\*) FROM student\_session\_allowances WHERE remaining \< 0;

SQL

echo "\[2/8\] Atomic decrement function test..."

supabase db execute \--branch stage-3-pricing \<\<'SQL'

\-- Test decrement on a test student

SELECT decrement\_student\_allowance('\<test\_student\_uuid\>', 'private');

SELECT remaining FROM student\_session\_allowances 

WHERE student\_id \= '\<test\_student\_uuid\>' AND session\_type \= 'private';

SQL

echo "\[3/8\] TypeScript..."

npx tsc \--noEmit

echo "\[4/8\] Build..."

npm run build

echo "\[5/8\] Pricing helpers unit tests..."

npx vitest run src/lib/pricing/\_\_tests\_\_/

echo "\[6/8\] Deploy preview..."

PREVIEW\_URL=$(deploy\_preview "stage-3")

echo "\[7/8\] Smoke test..."

smoke\_test\_preview "$PREVIEW\_URL"

echo "\[8/8\] Playwright regression..."

PREVIEW\_URL="$PREVIEW\_URL" npx playwright test tests/playwright/migrations/

echo "=== Stage 3 verification complete \==="

echo "Preview: $PREVIEW\_URL"

---

## Stage 3 — Gate 4: Visual Walk (Claude in Chrome)

Visual walk for Stage 3\. Test the admin package editor with new fields.

WALK:

1\. Log in as admin → /admin/packages

   \- Confirm existing packages list loads, no visual regression

   \- Click "Edit" on an existing package

   \- Confirm form loads

   \- Confirm new "Session Type Allowances" section appears

   \- Confirm three inputs (Private/Halaqa/Lecture)

   \- Existing private allowance value should pre-fill

   \- Try editing all three values, save, confirm persists on reload

2\. Create a new package

   \- Confirm new fields default to 0

   \- Set private=4, halaqa=2, lecture=0

   \- Save, confirm creates correctly

3\. Student dashboard regression

   \- Log in as test student with existing package

   \- Confirm dashboard shows correct remaining sessions (should match pre-Stage-3 behavior)

   \- No visual changes expected

4\. Public packages page (/packages)

   \- Visit page, confirm visual parity with production

   \- Pricing should display identically (still hidePrices=true on homepage; /packages may show differently per existing behavior)

For each step: screenshot, console errors, pass/fail.

Save to: docs/migrations/visual-walks/stage-3-walk.md

gh pr create \--title "Stage 3: Pricing scaffolding" \\

  \--body-file docs/migrations/STAGE\_3\_NOTES.md \--base main \--label "migration,stage-3"

gh pr merge \--squash \--delete-branch

supabase db push \--linked

supabase branches delete stage-3-pricing

Stage 3 complete. ✅

---

# STAGE 4 — Dashboard Read-Only Awareness

**Goal:** Surface session\_type in existing dashboards as read-only display. Teachers, students, admins, moderators all see what type each session is. No new flows. No booking changes.

**Branch:** `feat/sessions-stage-4-dashboards` **Supabase branch:** `stage-4-dashboards` **Estimated time:** 3–5 hours

---

## Stage 4 — Gate 1: Pre-flight Audit

**Paste into Claude Code:**

Audit before Stage 4\. Save to docs/migrations/STAGE\_4\_AUDIT.md.

1\. SESSION LIST COMPONENTS — find every component that renders a session in any dashboard. List file paths and props.

2\. SESSION DETAIL VIEWS — every place a single session is shown in detail.

3\. SESSION CARD COMPONENT — if shared, where it lives.

4\. SHARED SESSION HOOKS / SERVER ACTIONS — list every getter that fetches sessions.

5\. CURRENT EMPTY/LOADING STATES — what they look like.

6\. DESIGN-SYSTEM COMPONENTS — confirm what badge/pill components already exist for tagging items.

End: "Stage 4 audit complete."

---

## Stage 4 — Gate 2: Implementation

Implement Stage 4 of FURQAN session modes.

Reference: docs/migrations/STAGE\_4\_AUDIT.md

Branch: feat/sessions-stage-4-dashboards

Scope — read-only display additions only:

1\. SESSION TYPE BADGE COMPONENT

   Path: src/components/sessions/SessionTypeBadge.tsx

   

   \- Renders a pill with bilingual label

     \- private → "خاص / Private"

     \- halaqa → "حلقة / Halaqa"

     \- lecture → "مجلس / Majlis"

   \- Use design system tokens; gold \#B8922D ONLY if interactive (this badge is not interactive — use neutral surface \+ subtle border)

   \- Different subtle background tints per type:

     \- private: warm neutral

     \- halaqa: subtle emerald (community)

     \- lecture: subtle indigo (broadcast)

   \- Use existing typography scale; no new fonts

   \- RTL-safe spacing

   \- Default size variant \+ sm variant for table rows

2\. SESSION CARDS — INTEGRATE BADGE

   \- Find all session card / list-row components per audit

   \- Add the badge in a consistent location (next to title or in metadata row)

   \- Do not redesign; minimum-invasive insertion

   \- Preserve all existing layout

3\. SESSION DETAIL VIEWS

   \- Show badge prominently

   \- Show session\_topic\_ar / session\_topic\_en if present

   \- Show surah\_reference and ayah\_range if present (formatted in Arabic numerals for RTL view)

   \- Show enrollment count for halaqa/lecture (e.g., "3/15 enrolled")

   \- For private sessions, no enrollment counter (n/a)

4\. ADMIN SESSIONS LIST

   \- Add a filter dropdown: "All / Private / Halaqa / Lecture"

   \- Default: All

   \- Filter is client-side on the existing list (no new server query needed for now)

5\. NO NEW PAGES, NO NEW ROUTES

   \- All changes are component-level additions to existing pages

6\. STAGE NOTES

   docs/migrations/STAGE\_4\_NOTES.md

DO NOT:

\- Build halaqa booking

\- Build group video UI

\- Touch the public site

\- Redesign existing components

After: build, types, accessibility check (run npm run lint with a11y rules if configured), commit.

Commit:

"feat(sessions): stage 4 — dashboard awareness for session types

Adds SessionTypeBadge component, integrates into all session cards

and detail views across student/teacher/admin/moderator dashboards.

Adds session\_type filter to admin sessions list. No new flows.

Stage 4 of FURQAN session modes migration."

---

## Stage 4 — Gate 3: Automated Verification

`docs/migrations/runbooks/stage-4-verify.sh`:

\#\!/usr/bin/env bash

set \-euo pipefail

source scripts/migration-helper.sh

echo "=== Stage 4 Verification \==="

\# No DB migration this stage — UI only

echo "\[1/6\] TypeScript..."

npx tsc \--noEmit

echo "\[2/6\] Build..."

npm run build

echo "\[3/6\] Lint..."

npm run lint

echo "\[4/6\] Component snapshot tests..."

npx vitest run src/components/sessions/\_\_tests\_\_/

echo "\[5/6\] Deploy preview..."

PREVIEW\_URL=$(deploy\_preview "stage-4")

echo "\[6/6\] Playwright dashboard tests..."

PREVIEW\_URL="$PREVIEW\_URL" npx playwright test tests/playwright/migrations/dashboards.spec.ts

echo "=== Stage 4 verification complete \==="

`tests/playwright/migrations/dashboards.spec.ts`:

import { test, expect } from '@playwright/test';

test.describe('Stage 4 — dashboard awareness', () \=\> {

  test('admin sees session type badges', async ({ page }) \=\> {

    // Use a session-injected auth flow or test login route

    await page.goto('/admin/sessions');

    await expect(page.locator('\[data-testid="session-type-badge"\]').first()).toBeVisible();

  });

  test('admin can filter sessions by type', async ({ page }) \=\> {

    await page.goto('/admin/sessions');

    await page.getByRole('combobox', { name: /type/i }).selectOption('private');

    const badges \= page.locator('\[data-testid="session-type-badge"\]');

    const count \= await badges.count();

    for (let i \= 0; i \< count; i++) {

      await expect(badges.nth(i)).toContainText(/Private|خاص/);

    }

  });

  test('teacher dashboard shows badges', async ({ page }) \=\> {

    await page.goto('/teacher/dashboard');

    await expect(page.locator('\[data-testid="session-type-badge"\]').first()).toBeVisible();

  });

  test('student dashboard shows badges', async ({ page }) \=\> {

    await page.goto('/student/dashboard');

    await expect(page.locator('\[data-testid="session-type-badge"\]').first()).toBeVisible();

  });

});

---

## Stage 4 — Gate 4: Visual Walk (Claude in Chrome)

Visual walk for Stage 4\. New SessionTypeBadge appears across dashboards.

For each dashboard, log in with the appropriate test account and walk:

ADMIN

  /admin/dashboard           — badges visible on session widgets

  /admin/sessions            — badge column \+ filter dropdown works

  /admin/sessions/\[id\]       — badge prominent on detail view

TEACHER

  /teacher/dashboard         — badges on upcoming session list

  /teacher/sessions          — badges on each row

  /teacher/sessions/\[id\]     — badge on detail

STUDENT

  /student/dashboard         — badges on booked sessions

  /student/sessions          — badges per session

  /student/sessions/\[id\]     — badge on detail

MODERATOR

  /moderator/dashboard       — badges if sessions visible

Quality checks for the badge:

\- Color contrast meets WCAG AA in dark mode

\- RTL: badge appears on the correct side in Arabic

\- Spacing: doesn't break existing layouts on mobile or desktop

\- Bilingual: text switches when language toggles

\- Filter dropdown: opens, closes, filters list, no console errors

Take screenshots of: admin sessions list, teacher dashboard, student dashboard, badge close-up (zoomed)

If any badge looks visually off (wrong color, weak contrast, layout break), flag it specifically with the file path so it can be fixed.

Save report to: docs/migrations/visual-walks/stage-4-walk.md

gh pr create \--title "Stage 4: Dashboard awareness for session types" \\

  \--body-file docs/migrations/STAGE\_4\_NOTES.md \--base main \--label "migration,stage-4"

gh pr merge \--squash \--delete-branch

Stage 4 complete. ✅

**Pause point:** After Stage 4, you have the full backend for session modes and clear UI surfacing of types — but still only private sessions actually happen. This is a safe pause point if you want to continue Track B (UI Excellence) before adding halaqa booking. Recommended.

---

# STAGE 5 — Halaqa Booking & Enrollment Flow

**Goal:** Students can browse, book, and enroll in halaqa sessions. Admins can create halaqa sessions and set capacity. Teachers can review enrollment. No video changes yet — joining a halaqa lands on a placeholder "Halaqa coming soon" page.

**Branch:** `feat/sessions-stage-5-halaqa-booking` **Supabase branch:** `stage-5-booking` **Estimated time:** 12–18 hours

---

## Stage 5 — Gate 1: Pre-flight Audit

Audit before Stage 5\. Save to docs/migrations/STAGE\_5\_AUDIT.md.

1\. CURRENT BOOKING FLOW — trace start to finish: how does a student book a private session today?

2\. CALENDAR / SCHEDULING — how is a session scheduled? what UI?

3\. CAPACITY HANDLING — any existing concept of limits per session

4\. WAITING LIST OR OVERSELL PROTECTION — does it exist?

5\. NOTIFICATION TRIGGERS — what fires emails/SMS when a booking happens

6\. CANCEL/REFUND — how is a private cancellation handled

7\. NEW PRIMITIVES NEEDED — list what's missing for halaqa enrollment

8\. RISK MATRIX

End: "Stage 5 audit complete."

---

## Stage 5 — Gate 2: Implementation

Implement Stage 5 — halaqa booking and enrollment.

Reference: docs/migrations/STAGE\_5\_AUDIT.md

Branch: feat/sessions-stage-5-halaqa-booking

This is the largest stage so far. Read carefully, ask questions if anything is unclear.

Scope:

1\. ADMIN: HALAQA SESSION CREATION

   /admin/sessions/new — extend existing form:

   \- Session type selector (existing options \+ halaqa)

   \- When halaqa selected, reveal halaqa-specific fields:

     \- Title (Arabic \+ English, required)

     \- Description (Arabic \+ English)

     \- Topic (surah\_reference, ayah\_range, session\_topic\_ar, session\_topic\_en)

     \- Capacity: min\_participants (default 3), max\_participants (default 10, max 15\)

     \- Recurrence: one-time vs weekly (just add a recurring boolean for now; full recurrence engine later)

     \- Allow recording: opt-in checkbox

   \- Validation: max ≤ 15, min ≥ 2, min ≤ max

   \- On save: create session row with session\_type='halaqa'; do NOT create participant rows yet (enrollment fills them)

2\. STUDENT-FACING HALAQA BROWSE

   New page: /student/halaqas

   \- List all upcoming halaqa sessions accepting enrollment

   \- Show: title, teacher name, scheduled time (with student's timezone — use Intl), topic, capacity (e.g., "5/10 enrolled"), price (or "included in your package")

   \- Filter: teacher, day-of-week, level (if level field exists on packages)

   \- RTL-first layout, bilingual

3\. STUDENT: HALAQA DETAIL & ENROLLMENT

   New page: /student/halaqas/\[id\]

   \- Full details, teacher bio link, related materials if any

   \- "Enroll" button — disabled if:

     \- student already enrolled

     \- capacity full

     \- student has no halaqa allowance remaining (check student\_session\_allowances)

     \- session starts in less than X minutes (config: 30 min)

   \- Enrollment server action:

     \- Validate eligibility (server-side re-check, not just client)

     \- Atomic transaction:

       \- Insert session\_participants row (role='student')

       \- Increment sessions.current\_enrollment

       \- Decrement student\_session\_allowances.used (via atomic function)

     \- On failure (capacity race), return clear error \+ suggest waiting list

   \- Use useActionState pattern

4\. WAITING LIST (basic)

   New table:

     CREATE TABLE halaqa\_waiting\_list (

       id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),

       session\_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,

       student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

       position INT NOT NULL,

       created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

       UNIQUE(session\_id, student\_id)

     );

   \- When capacity full, "Enroll" becomes "Join waiting list"

   \- When a spot opens (someone cancels), promote first in line \+ send notification

   \- Promotion logic in a server action triggered by cancellation, NOT in n8n yet

5\. TEACHER: HALAQA ROSTER VIEW

   /teacher/halaqas/\[id\] (or extend existing session detail):

   \- Roster of enrolled students

   \- Each student: name, package status, attendance history

   \- Action: send roster announcement (drops a row in notifications table; actual email delivery in Phase C)

6\. STUDENT CANCELLATION

   \- "Leave halaqa" button on /student/halaqas/\[id\]

   \- If cancellation \> 24h before session: refund allowance, free up spot, promote waiting list

   \- If \< 24h: free spot, no refund (configurable later)

   \- Server action wraps in transaction

7\. ADMIN: HALAQA OVERVIEW

   /admin/halaqas:

   \- Table of all halaqas, with capacity %, enrolled count, waiting list count

   \- Click into any halaqa for the same detail view as teacher

8\. PLACEHOLDER JOIN PAGE

   /sessions/\[id\]/join for halaqa:

   \- Shows: "Halaqa video experience coming in next release"

   \- Shows session details, roster, scheduled time

   \- For private, this route continues to use the EXISTING video page (no change)

   \- Branch on session\_type at the route handler

9\. RLS UPDATES

   \- halaqa\_waiting\_list: SELECT own \+ teacher of session \+ admin

   \- sessions enrollment: enrolled students can read each other (per Stage 2\)

10\. NOTIFICATIONS (DB only — delivery later)

    Add notification rows on:

    \- successful enrollment

    \- waiting list promotion

    \- session cancelled by teacher

    Use the existing notifications table if present; if not, defer to Phase C.

11\. BILINGUAL CONTENT

    All new copy bilingual via t() pattern. New strings go in docs/content-inventory.md additions section. Ask user to confirm Arabic phrasing for any non-trivial copy.

12\. STAGE NOTES

    docs/migrations/STAGE\_5\_NOTES.md — schema diff, new pages list, known issues, follow-ups for Stage 6\.

DO NOT:

\- Build the group video UI (Stage 6\)

\- Wire Stripe payment changes (out of scope)

\- Build full notifications delivery (Phase C in roadmap)

\- Touch private session flow

After: build, types, lint, tests, fix before commit.

Commit:

"feat(sessions): stage 5 — halaqa booking and enrollment

Adds halaqa session creation, browse, enrollment, waiting list,

teacher roster, admin overview. Atomic capacity guarantees.

Placeholder join page until video UI ships in Stage 6\.

Stage 5 of FURQAN session modes migration."

---

## Stage 5 — Gate 3: Automated Verification

`docs/migrations/runbooks/stage-5-verify.sh`:

\#\!/usr/bin/env bash

set \-euo pipefail

source scripts/migration-helper.sh

echo "=== Stage 5 Verification \==="

supabase db push \--branch stage-5-booking

echo "\[1/10\] Schema check..."

supabase db execute \--branch stage-5-booking \<\<'SQL'

SELECT count(\*) FROM halaqa\_waiting\_list;

\\d session\_participants

\\d halaqa\_waiting\_list

SQL

echo "\[2/10\] Build & types..."

npm run build && npx tsc \--noEmit

echo "\[3/10\] Capacity race condition test..."

node tests/migrations/halaqa-capacity-race.mjs

echo "\[4/10\] Allowance decrement integration test..."

node tests/migrations/halaqa-allowance.mjs

echo "\[5/10\] Waiting list promotion test..."

node tests/migrations/halaqa-waiting-list.mjs

echo "\[6/10\] Cancellation refund test..."

node tests/migrations/halaqa-cancellation.mjs

echo "\[7/10\] Lint \+ a11y..."

npm run lint

echo "\[8/10\] Deploy preview..."

PREVIEW\_URL=$(deploy\_preview "stage-5")

echo "\[9/10\] Playwright e2e..."

PREVIEW\_URL="$PREVIEW\_URL" npx playwright test tests/playwright/migrations/halaqa-booking.spec.ts

echo "\[10/10\] Runtime logs..."

get\_preview\_logs "$PREVIEW\_URL" | grep \-i error | head

echo "=== Stage 5 verification complete \==="

echo "Preview: $PREVIEW\_URL"

The capacity race test (`halaqa-capacity-race.mjs`) creates a halaqa with capacity 5, then fires 10 concurrent enrollment requests, asserts exactly 5 succeed and 5 join waiting list — no overselling.

---

## Stage 5 — Gate 4: Visual Walk (Claude in Chrome)

Visual walk for Stage 5\. End-to-end halaqa booking flow.

ADMIN FLOW

1\. Log in as admin → /admin/sessions/new

   \- Select "Halaqa" type

   \- Confirm halaqa-specific fields appear with bilingual labels

   \- Create test halaqa: capacity 4, scheduled 2 days from now

   \- Save, confirm success

STUDENT FLOW (test student with halaqa allowance)

2\. Log in as student → /student/halaqas

   \- Confirm new page exists, lists the halaqa

   \- Confirm capacity shows "0/4"

   \- Click into detail

   \- Enroll

   \- Confirm success message, capacity now "1/4"

3\. Test 4 different students enrolling

   \- All 4 should succeed

   \- 5th student should see "Full — join waiting list"

   \- Waiting list join works, position \= 1

4\. Cancellation flow

   \- One enrolled student cancels

   \- Confirm capacity opens to 3/4

   \- Confirm waiting list student promoted (in DB at minimum; UI notification later)

5\. Teacher view

   \- Log in as teacher of the halaqa

   \- /teacher/halaqas/\[id\]

   \- Confirm roster shows 4 students with package status

6\. Cross-cutting

   \- All pages RTL when Arabic selected

   \- All pages LTR when English selected

   \- No console errors anywhere

   \- Mobile view (resize browser to 380px): all pages usable

VISUAL QUALITY

\- Halaqa list cards: do they look on-brand? Gold \#B8922D used only on interactive elements (Enroll button, filter chips)?

\- Capacity indicator: visually clear (e.g., "3/10" or progress ring)?

\- Empty states: when no halaqas exist, is the empty state helpful?

\- Disabled "Enroll" button: clear why (capacity full / no allowance / already enrolled)?

If any visual issue: flag with file path. If any UX confusion: flag with suggestion.

Save to: docs/migrations/visual-walks/stage-5-walk.md

gh pr create \--title "Stage 5: Halaqa booking & enrollment" \\

  \--body-file docs/migrations/STAGE\_5\_NOTES.md \--base main \--label "migration,stage-5"

gh pr merge \--squash \--delete-branch

Stage 5 complete. ✅

---

# STAGE 6 — Halaqa Live Session UI

**Goal:** When a student or teacher joins a halaqa, they get a real group video experience: grid view, current-reciter spotlight, teacher controls, hand-raising. Replaces the Stage 5 placeholder.

**Branch:** `feat/sessions-stage-6-halaqa-video` **Supabase branch:** `stage-6-video` **Estimated time:** 15–25 hours

---

## Stage 6 — Gate 1: Pre-flight Audit

Audit before Stage 6\. Save to docs/migrations/STAGE\_6\_AUDIT.md.

1\. EXISTING VIDEO PAGE — file path, components used (Daily React hooks?), state management

2\. DAILY.CO REACT INTEGRATION — current version, API surface used

3\. TOKEN ISSUANCE FLOW — when is the token fetched, how passed to Daily provider

4\. UI PRIMITIVES — buttons, modals, layouts available in design system

5\. RTL AUDIO/VIDEO QUIRKS — anything Daily does that breaks RTL

6\. PERFORMANCE BUDGET — current bundle size of session page

7\. RISKS for adding 15-participant grid

8\. PRECONDITIONS

End: "Stage 6 audit complete."

---

## Stage 6 — Gate 2: Implementation

Implement Stage 6 — halaqa live session UI.

Reference: docs/migrations/STAGE\_6\_AUDIT.md

Branch: feat/sessions-stage-6-halaqa-video

CRITICAL: Do NOT touch the existing private session video page. The new halaqa UI is a separate route/component.

Scope:

1\. ROUTE BRANCHING

   /sessions/\[id\]/join handler:

   \- If session\_type \= 'private' → existing video page (unchanged)

   \- If session\_type \= 'halaqa' → new HalaqaSessionPage component

   \- If session\_type \= 'lecture' → "Lecture mode coming soon" placeholder

2\. HALAQA SESSION PAGE

   Path: src/app/sessions/\[id\]/halaqa/page.tsx

   

   Layout (desktop, RTL/LTR responsive):

   \- Top bar: session title, surah/ayah reference if set, end-session button (teacher only), recording indicator if active

   \- Main grid: participant tiles (DailyVideo per active participant)

     \- Up to 15 tiles

     \- Auto-layout: 2x2 for 4, 3x3 for 9, 4x4 for 12-15, etc.

     \- Active speaker emphasized (subtle ring)

     \- "Current reciter" spotlight: when teacher selects a student, that tile enlarges

   \- Right sidebar (collapsible on mobile):

     \- Participants list with hand-raise indicators

     \- Teacher-only controls: mute all, unmute selected, "next reciter" button

     \- Quran reference panel: shows surah\_reference \+ ayah\_range, optional mushaf link

   \- Bottom bar: mic toggle, camera toggle, hand raise (students), leave button

3\. TEACHER CONTROLS

   \- Mute all students (one click)

   \- Promote student to active reciter (selects them as spotlight, unmutes them, mutes others)

   \- "Next reciter" cycles through enrolled list

   \- End session for everyone

4\. STUDENT EXPERIENCE

   \- Default: muted on join

   \- Hand-raise toggle (sends data via Daily's app message API)

   \- Camera-on by default for halaqa (configurable)

   \- Cannot end session

   \- Cannot promote others

5\. CURRENT RECITER FEATURE

   \- State synced via Daily app messages

   \- Visual indicator on the spotlit tile: gold ring \+ "يقرأ الآن / Reciting now" label

   \- Audio focus: spotlit student unmuted, others muted (teacher initiated)

6\. ATTENDANCE TRACKING

   \- On participant join → update session\_participants.joined\_at \+ attendance\_status='attended'

   \- On participant leave → update left\_at

   \- If session ends and a participant never joined → status='absent'

7\. ADMIN OBSERVATION (continued from Stage 2\)

   \- Admin joins as hidden observer

   \- Observer is NOT in the participant grid

   \- Observer sees a "you are observing" banner, can hear/see but not interact

   \- Toggle to leave observation mode

8\. RECORDING INDICATOR

   \- If session.allow\_recording \= true AND recording active → "REC" badge top bar

   \- Bilingual

9\. ERROR HANDLING

   \- Token expired → re-issue

   \- Connection lost → reconnect with backoff

   \- Permissions denied → clear error UI

10\. PERFORMANCE

    \- Lazy-load Daily SDK

    \- Virtualize participant tile grid for 10+ participants

    \- Audit bundle size after; report in Stage Notes

11\. BILINGUAL

    \- All new strings in t() pattern

    \- RTL audio/video controls mirrored

    \- Confirm Daily's UI components don't override RTL

12\. ACCESSIBILITY

    \- Keyboard navigation through controls

    \- Screen-reader labels on tiles ("X is reciting", "Y has hand raised")

    \- Sufficient contrast on overlays

13\. STAGE NOTES

    docs/migrations/STAGE\_6\_NOTES.md

DO NOT:

\- Touch the private session video page

\- Build lecture broadcast UI (Stage 7\)

\- Modify Daily account settings

\- Integrate Stripe

After: build, types, lint, tests, fix before commit.

Commit:

"feat(sessions): stage 6 — halaqa live session UI

Adds group video grid, teacher controls, current reciter spotlight,

hand-raising, attendance tracking, admin hidden observation,

Quran reference panel. Private session UI unchanged.

Stage 6 of FURQAN session modes migration."

---

## Stage 6 — Gate 3: Automated Verification

echo "\[1/10\] DB push (no schema changes expected)..."

supabase db push \--branch stage-6-video || echo "No changes"

echo "\[2/10\] Build, types, lint..."

npm run build && npx tsc \--noEmit && npm run lint

echo "\[3/10\] Component unit tests..."

npx vitest run src/app/sessions/\[id\]/halaqa/\_\_tests\_\_/

echo "\[4/10\] Bundle size check..."

node scripts/check-bundle-size.mjs  \# custom: warn if session page bundle \> target

echo "\[5/10\] Deploy preview..."

PREVIEW\_URL=$(deploy\_preview "stage-6")

echo "\[6/10\] Playwright video tests..."

PREVIEW\_URL="$PREVIEW\_URL" npx playwright test tests/playwright/migrations/halaqa-video.spec.ts

echo "\[7/10\] Multi-participant simulation..."

node tests/migrations/halaqa-multi-participant.mjs  \# spawn 5 headless browsers, all join

echo "\[8/10\] Private session regression — make sure existing flow still works..."

PREVIEW\_URL="$PREVIEW\_URL" npx playwright test tests/playwright/migrations/private-session-regression.spec.ts

echo "\[9/10\] A11y scan with axe..."

PREVIEW\_URL="$PREVIEW\_URL" npx playwright test tests/playwright/migrations/halaqa-a11y.spec.ts

echo "\[10/10\] Runtime logs..."

get\_preview\_logs "$PREVIEW\_URL" | grep \-iE 'error|warn' | head \-30

---

## Stage 6 — Gate 4: Visual Walk (Claude in Chrome)

This is the most demanding visual walk. Have at least 4 browser windows ready (different test accounts).

Visual walk for Stage 6 — halaqa live session.

PRIVATE REGRESSION FIRST

1\. Log in as admin → schedule a private session for 5 minutes from now

2\. Teacher and student both join → confirm video page LOOKS AND BEHAVES IDENTICALLY to before Stage 6

3\. End session

HALAQA HAPPY PATH

4\. Admin: schedule a halaqa for 5 min from now, capacity 5

5\. Three students enroll

6\. Teacher joins → confirm halaqa video page loads (NOT the private one)

7\. Three students join

8\. Confirm 4 tiles in grid (1 teacher \+ 3 students)

9\. Teacher mutes all → confirm mics off

10\. Teacher promotes student \#1 → confirm gold ring \+ "Reciting now" label

11\. Student \#1 unmuted, others muted (verify audio levels in Daily)

12\. Student \#2 raises hand → teacher sees indicator

13\. Teacher clicks "next reciter" → spotlight moves

14\. Admin (separate window) joins as observer → confirm hidden from participant grid for others

15\. Teacher ends session

QUALITY CHECKS

\- Grid layout adapts cleanly when 1, 2, 4, 9 participants

\- Spotlight transitions are smooth (no jank)

\- RTL: hand-raise icon position correct, controls mirrored

\- LTR: same flow works in English

\- Mobile (resize to 380px): sidebar collapses, grid adapts to 1-2 columns

\- Bilingual labels everywhere; Arabic typography readable

\- Recording indicator: appears when teacher starts recording

\- Quran reference panel: shows surah/ayah cleanly

EDGE CASES

\- Disconnect a student's network mid-session → confirm reconnect works

\- Try joining an already-full halaqa → blocked with clear message

\- Try joining 1 hour before scheduled time → blocked or "lobby" mode (per design)

If any visual issue, UX confusion, or behavior bug: flag with file path and suggested fix.

Save to: docs/migrations/visual-walks/stage-6-walk.md

End:

  ✅ "Stage 6 visual walk PASSED"

  ⚠️ PASSED with notes

  ❌ FAILED — list blockers

gh pr create \--title "Stage 6: Halaqa live video UI" \\

  \--body-file docs/migrations/STAGE\_6\_NOTES.md \--base main \--label "migration,stage-6"

gh pr merge \--squash \--delete-branch

Stage 6 complete. ✅ **Halaqa is now live end-to-end.**

---

# STAGE 7 — Lecture Mode (Conditional)

**Goal:** If demand exists by this point (real teachers asking, real students requesting), build lecture broadcast mode. Otherwise, **defer indefinitely** and use a `lecture_url` field for YouTube Live links instead.

**Decision gate:** Before starting Stage 7, answer:

- Have at least 2 teachers asked for lecture mode?  
- Have at least 10 paying students asked for lectures?  
- Is it on the critical path for revenue this quarter?

If any "no" → skip Stage 7\. Add a `external_lecture_url` text column to sessions, render it on the session detail page, ship a YouTube Live integration, move on.

If all "yes" → proceed with Stage 7 below.

**Branch:** `feat/sessions-stage-7-lecture` **Estimated time:** 20–30 hours (significant)

\[Detailed Stage 7 spec follows the same structure as Stage 6, with broadcast-specific UI: large speaker view, listener-only mode, hand-raise → "speak request" promotion, ticketed registration. Full spec deferred until decision gate confirms.\]

---

# Track A summary

After Stages 1–6 (and optional 7):

✅ Schema supports all three session modes ✅ Backend creates appropriate Daily rooms per type ✅ Multi-participant RLS works correctly ✅ Pricing model knows about session types ✅ Dashboards surface type clearly ✅ Halaqa booking, enrollment, waiting list functional ✅ Halaqa group video experience live ✅ Private sessions work identically to before (regression-tested at every gate) ✅ Lecture mode deferred (or built if demand justified it)

**You can stop after any merged stage and the platform is in a coherent state.**

(Continued in Part 3 — Track B Visual Excellence Pass)

# FURQAN Migration Plan — Part 3

## Track B: UI Excellence Pass (Visual Walks Drive UI Improvements)

This track runs **in parallel** with Track A Stages 1–3 (which don't change UI). Track B uses Claude in Chrome as the engine for systematic visual improvement of dashboards and marketing site.

**Why parallel:** Stages 1–3 are backend-heavy. While Claude Code is doing schema/backend work on Track A branches, Track B can run independently on its own branches without merge conflicts.

**Three phases:**

- **Phase B1 — Marketing Site Polish** (the public 7-page site)  
- **Phase B2 — Dashboard Liquid Glass Corrective Pass** (fix the "generic frosted glass" issue per memory)  
- **Phase B3 — Component Library Consolidation** (shared components, reduce duplication)

Each phase has 3 gates: **Visual Audit → Implementation → Visual Verification.**

**Branch convention:** `design/B1-marketing-polish`, `design/B2-liquid-glass-fix`, `design/B3-components`.

---

# PHASE B1 — Marketing Site Polish

**Goal:** Take the 7-page public site from "live and functional" to "premium academy quality." Focus on typography rhythm, white space, image quality, micro-interactions, mobile polish.

**Branch:** `design/B1-marketing-polish` **Estimated time:** 8–15 hours

---

## B1 — Gate 1: Visual Audit (Claude in Chrome)

Open furqan.today in Chrome with Claude extension active.

**Paste into Claude in Chrome:**

You are doing a senior design audit of the FURQAN marketing site (furqan.today).

Reference design system: .impeccable.md (dark \#0a0a0a background, gold \#B8922D for interactive only, Arabic-first RTL).

For each of the 7 pages, evaluate:

PAGES

  /              (homepage)

  /about

  /services

  /packages

  /teachers

  /blog

  /contact

EVALUATION CRITERIA per page:

A. TYPOGRAPHY

   \- Heading hierarchy clear?

   \- Line height comfortable for Arabic reading?

   \- Font sizes responsive?

   \- Letter spacing on Arabic body text appropriate?

B. SPACING & RHYTHM

   \- Vertical rhythm consistent?

   \- Section padding mobile vs desktop?

   \- Inconsistent gaps?

C. COLOR USAGE

   \- Gold \#B8922D used ONLY on interactive elements? (flag any decorative misuse)

   \- Background contrast sufficient (WCAG AA)?

   \- Subtle accent colors aligned with brand?

D. IMAGERY

   \- Image quality acceptable?

   \- Compression artifacts?

   \- Aspect ratios consistent?

   \- Aspect ratios respect mobile viewport?

E. MICRO-INTERACTIONS

   \- Hover states present and feel premium?

   \- Button feedback clear?

   \- Page transitions smooth?

   \- Loading states polished?

F. RTL CORRECTNESS

   \- Text aligned correctly?

   \- Icons mirrored where appropriate?

   \- Numbers in Arabic vs Latin script — consistent choice?

   \- Bilingual switching smooth?

G. MOBILE

   \- Resize to 380px — does the page hold up?

   \- Touch targets at least 44x44px?

   \- Text legible without zoom?

H. PERFORMANCE FELT

   \- Page feels fast or sluggish?

   \- Layout shift on load?

   \- Hero images delay rendering?

For each page, produce a table:

| Criterion | Status | Specific issue | Fix priority (P0/P1/P2) |

Prioritize issues:

  P0 — broken or visibly amateur

  P1 — feels mid-tier; would prevent academy from feeling premium

  P2 — nice-to-have polish

Take screenshots of every page (desktop \+ mobile).

End with:

1\. TOP 10 P0/P1 ISSUES across the entire site

2\. RECOMMENDED ORDER OF FIX

Save report to: docs/migrations/visual-walks/B1-audit.md

**Human gate:** Review the audit. The Top 10 list becomes Phase B1's implementation backlog.

---

## B1 — Gate 2: Implementation

**Paste into Claude Code:**

Implement Phase B1 — marketing site polish.

Reference: docs/migrations/visual-walks/B1-audit.md

Branch: design/B1-marketing-polish

CRITICAL: Do not break any functionality. Visual improvements only.

CRITICAL: Use real bilingual content from docs/content-inventory.md. Do NOT invent Arabic.

CRITICAL: Gold \#B8922D ONLY on interactive elements per .impeccable.md.

Scope: address the Top 10 P0/P1 issues from the audit, in the recommended order.

For each issue:

\- Identify the exact file(s) and line(s)

\- Make the minimum change to fix

\- Verify visually still aligned with .impeccable.md

\- Note what changed in docs/migrations/B1\_NOTES.md

Constraints:

\- Do not redesign whole sections; refine

\- Use existing Tailwind v4 @theme tokens; do not introduce new color values

\- Use existing typography scale; do not add new font sizes

\- Mobile-first; test at 380px width

\- Bilingual: confirm both AR and EN look good for every change

After: build, types, lint. Commit with descriptive message per issue group.

When all 10 done:

\- Run a final pre-walk smoke check yourself: load each page on the local dev server and confirm no obvious regressions

Final commit message:

"design(B1): marketing site polish pass

Addresses top P0/P1 issues from B1-audit:

\- \[list the actual changes\]

Phase B1 of UI excellence pass."

---

## B1 — Gate 3: Visual Verification (Claude in Chrome)

Deploy preview, then open in Chrome with Claude.

Verify Phase B1 implementation against the audit.

Reference: docs/migrations/visual-walks/B1-audit.md (the audit findings)

For each P0/P1 issue from the audit:

1\. Visit the affected page on the new preview URL

2\. Confirm the issue is resolved

3\. Take a before/after comparison screenshot (use furqan.today as "before")

4\. Note any new issues introduced

For each, mark:

  ✅ Fixed cleanly

  ⚠️ Partially fixed (specify what remains)

  ❌ Not fixed or made worse

Also do a fresh full-site walk:

\- Have any new issues appeared as side effects?

\- Any visual regressions in pages we didn't intend to change?

Save report to: docs/migrations/visual-walks/B1-verification.md

End:

  ✅ "Phase B1 verified — ready to merge"

  ⚠️ "Phase B1 needs another iteration — see open items"

If iteration needed: feed open items back to Claude Code, repeat Gate 2 \+ Gate 3\. Don't merge until clean.

gh pr create \--title "Phase B1: Marketing site polish" \\

  \--body-file docs/migrations/B1\_NOTES.md \--base main \--label "design,phase-b1"

gh pr merge \--squash \--delete-branch

Phase B1 complete. ✅

---

# PHASE B2 — Dashboard Liquid Glass Corrective Pass

**Goal:** Fix the "generic frosted glass" implementation per the existing memory. Achieve true Apple-style liquid glass on dashboard surfaces. Bring the 4 dashboards from \~85–88% reference parity to 95%+.

**Branch:** `design/B2-liquid-glass-fix` **Estimated time:** 12–20 hours

This phase has the most existing context — there's a corrective Claude Code prompt already prepared per memory. We integrate it here with the gate structure.

---

## B2 — Gate 1: Visual Audit (Claude in Chrome)

You are doing a senior design audit of the FURQAN dashboards, focused on the liquid glass effect.

Background context: A previous bulk update applied "frosted glass" but produced a generic effect rather than Apple-style liquid glass with proper specular highlights, depth blur, and edge refraction.

Reference: .impeccable.md design system \+ visual reference of Apple's liquid glass (Big Sur, Sonoma, Vision OS controls).

For each dashboard, audit:

DASHBOARDS (log in with appropriate test accounts)

  /admin/dashboard

  /teacher/dashboard

  /student/dashboard

  /moderator/dashboard

  Plus key sub-pages of each (sessions list, settings, etc.)

EVALUATION CRITERIA:

A. SURFACE TREATMENT

   \- Does each card have proper translucent material vs flat fill?

   \- Is the backdrop blur sufficient and not over-blurred?

   \- Is there depth-of-field falloff?

B. LIGHT HANDLING

   \- Specular highlight at the top edge of cards?

   \- Subtle bottom shadow under each surface?

   \- Inner edge highlight (1px white-ish at top)?

C. COLOR INTERACTION

   \- Does the dark background show through with appropriate vibrancy?

   \- Gold accents preserved without muddying the glass?

   \- Hierarchy clear (primary vs secondary surfaces)?

D. MOTION

   \- Hover states feel like physical material?

   \- Transitions smooth and natural?

   \- Cards don't "pop" awkwardly?

E. CONSISTENCY

   \- All glass surfaces share the same recipe?

   \- Or are some cards using different effects, looking incoherent?

F. PERFORMANCE

   \- Backdrop blur not killing scroll performance?

   \- Mobile devices handle the effect?

G. RTL/LTR PARITY

   \- Specular gradient angle mirrored in RTL? (per memory note)

   \- Light direction consistent with reading order?

For each dashboard, produce:

| Component | Current treatment | Target treatment | Gap | Priority |

Identify the top 15 surfaces that need correction (cards, modals, sidebars, headers).

Save to: docs/migrations/visual-walks/B2-audit.md

---

## B2 — Gate 2: Implementation

Implement Phase B2 — liquid glass corrective pass.

Reference: docs/migrations/visual-walks/B2-audit.md

Branch: design/B2-liquid-glass-fix

This corrects the "generic frosted glass" → true Apple liquid glass on dashboard surfaces.

THE CORRECT LIQUID GLASS RECIPE (canonical for FURQAN):

Apply via a shared utility class .liquid-surface or component \<LiquidSurface\>:

  background:

    linear-gradient(

      135deg,

      rgba(255, 255, 255, 0.08) 0%,

      rgba(255, 255, 255, 0.02) 50%,

      rgba(255, 255, 255, 0.04) 100%

    );

  backdrop-filter: blur(20px) saturate(180%);

  \-webkit-backdrop-filter: blur(20px) saturate(180%);

  border: 1px solid rgba(255, 255, 255, 0.10);

  border-top-color: rgba(255, 255, 255, 0.18);  /\* specular highlight top \*/

  box-shadow:

    inset 0 1px 0 0 rgba(255, 255, 255, 0.10),  /\* inner top highlight \*/

    0 4px 16px 0 rgba(0, 0, 0, 0.30),           /\* outer shadow \*/

    0 1px 2px 0 rgba(0, 0, 0, 0.20);

  border-radius: var(--radius-lg);

In RTL: angle becomes 225deg (mirrored), border-top-color becomes border-top \+ border-left mirrored appropriately.

For HOVER state, add:

  background gradient lifts slightly (rgba 0.10 → 0.04 → 0.06)

  border-top-color lifts to 0.22

  inner highlight to 0.14

  transition: 200ms ease-out

For ACTIVE/PRESSED, slight inset compression.

IMPLEMENTATION:

1\. CREATE SHARED PRIMITIVE

   Path: src/components/ui/LiquidSurface.tsx

   \- Props: children, hover (boolean), variant ('card' | 'panel' | 'modal' | 'header')

   \- Apply correct recipe per variant (modal has stronger blur, header is flatter)

   \- Direction-aware: read RTL/LTR from context, flip gradient angle

   \- Use Tailwind v4 @theme tokens where possible; inline only where Tailwind can't express

2\. REPLACE ON TOP 15 SURFACES (per audit)

   \- For each surface, swap the existing frosted-glass class for \<LiquidSurface variant="..."\>

   \- Preserve all child content, layout, behavior

   \- Verify in dark mode (FURQAN is dark by default per memory)

3\. ANIMATION POLISH

   \- Hover transitions on dashboard cards: 200ms ease-out

   \- Click feedback on interactive cards: 100ms scale 0.99 then back

   \- Subtle entrance animation on dashboard mount (stagger cards)

4\. PERFORMANCE

   \- Use will-change: backdrop-filter sparingly (only on currently animating surfaces)

   \- Profile scroll on the longest dashboard page; if jank, reduce blur radius selectively on mobile

5\. RTL VERIFICATION

   \- Switch to Arabic, walk every dashboard

   \- Confirm specular gradients appear on the correct side (top-left in RTL ≠ top-left in LTR)

6\. STAGE NOTES

   docs/migrations/B2\_NOTES.md — surfaces changed, before/after screenshots, performance metrics

Build, types, lint, commit per logical group:

"design(B2): liquid glass primitive

design(B2): apply liquid surface to admin dashboard cards

design(B2): apply to teacher/student/moderator dashboards

design(B2): hover and entrance animations

design(B2): RTL gradient mirroring"

---

## B2 — Gate 3: Visual Verification (Claude in Chrome)

Verify Phase B2 implementation. Compare new dashboard polish against:

1\. The B2 audit issues — are they all resolved?

2\. The reference image / Apple liquid glass aesthetic

3\. The 95% parity target

For each of the 4 dashboards:

\- Walk the main page

\- Walk 2 sub-pages

\- Switch language EN ↔ AR — confirm glass mirrors correctly

\- Hover every card — confirm transitions feel premium

\- Resize to 380px mobile — confirm glass still works (or has graceful mobile-specific recipe)

\- Open dev tools Performance tab; record a 3-second scroll on the longest dashboard → confirm 60fps

Take comparison screenshots: pre-B2 (production) vs post-B2 (preview).

Estimate parity to reference: \_\_% (target ≥95%)

Save to: docs/migrations/visual-walks/B2-verification.md

End:

  ✅ "Phase B2 verified — 95%+ parity"

  ⚠️ "Phase B2 at \_\_% — needs another pass"

  ❌ "Phase B2 has regressions or performance issues"

gh pr create \--title "Phase B2: Dashboard liquid glass corrective pass" \\

  \--body-file docs/migrations/B2\_NOTES.md \--base main \--label "design,phase-b2"

gh pr merge \--squash \--delete-branch

Phase B2 complete. ✅ This unblocks the visual parity v3 issue noted in your memory.

---

# PHASE B3 — Component Library Consolidation

**Goal:** Identify duplicated UI patterns across the 4 dashboards, extract into shared components, reduce future maintenance cost. Pure refactor — no visual change should result.

**Branch:** `design/B3-components` **Estimated time:** 6–10 hours

---

## B3 — Gate 1: Audit

Audit duplicated UI patterns across FURQAN.

Walk: src/app/admin/, src/app/teacher/, src/app/student/, src/app/moderator/

Identify:

1\. STAT CARDS — small "X count \+ label" cards. How many variants exist? Are they unified?

2\. SESSION LIST ROWS — cross-reference Stage 4 work; should already be unified

3\. EMPTY STATES — how many different empty states? Should be one shared component

4\. PAGE HEADERS — title \+ subtitle \+ action button pattern; how many variations?

5\. MODAL/DIALOG — confirmation dialogs, edit forms; consolidated?

6\. TABS — used in multiple dashboards; same component or each rolled own?

7\. FORMS — repeated input \+ label \+ error layouts

8\. AVATAR — student/teacher avatar with name; one component?

9\. STATUS PILLS — beyond SessionTypeBadge, what other status indicators?

10\. DATE/TIME DISPLAY — bilingual date formatting; unified?

For each, list the duplicates and propose consolidation.

Output: docs/migrations/visual-walks/B3-audit.md with extraction plan.

---

## B3 — Gate 2: Implementation

Implement Phase B3 — component consolidation.

Reference: docs/migrations/visual-walks/B3-audit.md

Branch: design/B3-components

GUIDING PRINCIPLE: visual output identical before/after. This is a pure refactor.

For each consolidation:

1\. Create shared component in src/components/ui/ or src/components/dashboards/

2\. Match existing visual exactly (use the most-polished current implementation as the source of truth, OR the .impeccable.md spec if specified there)

3\. Replace each duplicate call site

4\. Verify pixel parity at each call site (manual \+ Playwright snapshot if feasible)

CONSOLIDATIONS (typical list — adjust per audit):

\- StatCard

\- EmptyState

\- PageHeader (title \+ subtitle \+ actions slot)

\- ConfirmDialog

\- TabGroup

\- FormField (label \+ input \+ error \+ help)

\- UserAvatar (with size variants)

\- DateTimeDisplay (bilingual \+ RTL-aware)

\- StatusPill (variants: success, warning, info, neutral)

After each consolidation: snapshot before/after for verification, commit.

docs/migrations/B3\_NOTES.md tracks every consolidation with file moves.

Final commit:

"refactor(ui): consolidate dashboard components

Extracts N shared components, removes \~M duplicates across dashboards.

Visually identical; reduces maintenance cost.

Phase B3 of UI excellence pass."

---

## B3 — Gate 3: Visual Verification

Verify Phase B3 — visual parity check after refactor.

For each consolidated component, find every call site and verify:

\- Visual appearance unchanged from production

\- Behavior unchanged

\- No console errors

Use Playwright visual regression mode if possible:

  npx playwright test \--update-snapshots  (against production baseline)

Save to: docs/migrations/visual-walks/B3-verification.md

End: ✅/⚠️/❌

gh pr create \--title "Phase B3: Component consolidation" \\

  \--body-file docs/migrations/B3\_NOTES.md \--base main \--label "design,phase-b3"

gh pr merge \--squash \--delete-branch

Phase B3 complete. ✅

---

# Integration: How Track A and Track B fit together

Timeline (representative):

Week 1:  Track A Stage 1  \+  Track B Phase B1 (in parallel)

Week 2:  Track A Stage 2  \+  Track B Phase B1 finish \+ B2 start

Week 3:  Track A Stage 3  \+  Track B Phase B2 finish

Week 4:  Track A Stage 4  \+  Track B Phase B3

Week 5:  Track A Stage 5

Week 6:  Track A Stage 5 finish \+ Stage 6 start

Week 7:  Track A Stage 6

Week 8:  Stage 7 decision; if go, build; if no-go, ship YouTube Live integration instead.

**Merge cadence:** Each stage / phase merges independently to main. Track A merges trigger automatic preview deploys; Track B merges polish them. The two tracks never block each other because Stages 1–3 don't change UI and Phases B1–B3 don't change backend.

**Conflict resolution:** If Stage 4 (dashboards) and Phase B3 (component consolidation) touch the same files, the later branch must rebase before merging. Generally Track A goes first, Track B rebases.

---

# Master checklist (printable)

## Track A

- [ ] Environment setup (CLIs verified, Supabase linked, baseline captured)  
- [ ] Stage 1 — Schema (audit ✓, impl ✓, verify ✓, walk ✓, merged ✓)  
- [ ] Stage 2 — Backend (audit ✓, impl ✓, verify ✓, walk ✓, merged ✓)  
- [ ] Stage 3 — Pricing (audit ✓, impl ✓, verify ✓, walk ✓, merged ✓)  
- [ ] Stage 4 — Dashboards (audit ✓, impl ✓, verify ✓, walk ✓, merged ✓)  
- [ ] Stage 5 — Halaqa booking (audit ✓, impl ✓, verify ✓, walk ✓, merged ✓)  
- [ ] Stage 6 — Halaqa video (audit ✓, impl ✓, verify ✓, walk ✓, merged ✓)  
- [ ] Stage 7 — Lecture (decision gate ✓, build or defer)

## Track B

- [ ] Phase B1 — Marketing polish (audit ✓, impl ✓, verify ✓, merged ✓)  
- [ ] Phase B2 — Liquid glass fix (audit ✓, impl ✓, verify ✓, merged ✓)  
- [ ] Phase B3 — Component consolidation (audit ✓, impl ✓, verify ✓, merged ✓)

## Post-migration

- [ ] Update FURQAN\_N8N\_AUTOMATION\_PLAN.md to reflect new session\_type-aware workflows  
- [ ] Update .impeccable.md if any design tokens evolved  
- [ ] Update docs/content-inventory.md with all new bilingual strings  
- [ ] Archive baseline snapshots; create new "post-migration baseline" for future reference  
- [ ] Close out related issues; create follow-up tickets for Stripe wiring, Phase A homework, Phase C notifications

---

# Rollback strategy (per stage)

If a stage fails verification or causes production issues post-merge:

\# Revert the merge commit

gh pr list \--state merged \--label "migration" \--limit 5

git revert \-m 1 \<merge-commit-sha\>

git push origin main

\# Roll back Supabase migration

supabase migration list

\# Identify the migration and create a reverse migration

supabase migration new revert\_stage\_N

\# Write the reverse SQL, push it

supabase db push \--linked

\# Redeploy

npx vercel \--prod

Because each stage is small and gated, rollback should be \< 30 minutes.

---

# Final notes

**This plan is intentionally over-specified.** Senior teams write runbooks like this not because every step matters but because *the absence of a step* is what causes outages. Skip steps in the audit phase if you're confident; never skip the verification phase.

**Use Claude in Chrome aggressively.** It's the multiplier here. A human-driven visual walk takes 30 minutes per dashboard; Claude in Chrome with screenshots and structured reporting takes 5\. The time savings compound across 7 stages × 4 dashboards.

**The Stripe gap.** Per your direction, Stripe is out of scope here. After this migration completes, plan a dedicated "Stripe Wiring" phase that reads `student_session_allowances` and creates appropriate Stripe products/prices. The data model is ready; just needs the integration layer.

**One thing to watch:** Daily.co's pricing scales with participant-minutes. Halaqa sessions cost more per session than private (more participants), but you charge each enrolled student. Build a small dashboard widget in Phase B2 or post-migration that tracks Daily costs per session type — protects you from cost surprises as halaqas grow.

Good luck. The plan is ambitious but tractable. Take it one stage at a time.

— End of plan —  
