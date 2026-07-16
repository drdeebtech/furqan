# AGENTS.md — furqan.today

Quran-memorization platform. This file is the contract for every AI agent (Claude Code, Codex)
in this repo; `CLAUDE.md` symlinks here. It stays lean on purpose: general context, key guidelines,
and the agent's role. Deep reference lives in `docs/agents/`; task-specific instructions belong in
the task, not here.

**Stack:** Next.js App Router · TypeScript (strict) · Tailwind · Supabase (Postgres/Auth/RLS/Storage) ·
Stripe · Daily.co · Bunny CDN · Sentry · n8n · PWA · full RTL/Arabic · Vercel.

**Heads-up:** this repo runs a modified/canary Next.js — check `node_modules/next/dist/docs/` before
using an unfamiliar Next API. Running in Cursor Cloud? Read `docs/agents/cursor-cloud.md` first
(local Supabase bootstrap, Docker, gotchas).

---

## 1 · The Golden Rule (non-negotiable)

Judge every plan, edit, and review **through three lenses at once**. Fail one → not done.

| Lens | Owns |
|------|------|
| 🛠 Full-stack engineer | Next.js/TS/Supabase correctness, security, performance, tests |
| 📖 Quran teacher | text integrity, exact `surah:ayah`, tajweed, pedagogy |
| 🎓 Teaching-platform expert | learner UX, RTL/Arabic, motivation, accessibility |

Name the lens behind each non-trivial decision in plans and PRs.

## 2 · Quran integrity — highest priority

- Quran text and surah/ayah facts are **never generated, edited, or "corrected"** by a model.
  Rendered ayah text comes only from a verified source. Canonical structure: `src/lib/quran/`
  (`surahs.ts`, `ayah-counts.ts`), mirrored to `quran_surahs_reference` — read from there;
  never hardcode counts.
- `surah:ayah` must be exact; ranges validate against `ayah-counts.ts` (DB-enforced by the
  `student_progress_ayah_range_guard` migration — never bypass it).
- Preserve tashkeel, tajweed marks, and waqf signs byte-for-byte.
- ASR output is only compared *against* canonical text — never stored as a Quran source.
- Unsure on a fiqh/tajweed point → flag for human review, don't guess.

## 3 · Security — hard lines

- RLS on every table; never disable it; new tables ship their policies in the same migration.
- Service-role key is **server-only**. Never in a client component, `NEXT_PUBLIC_*`, or logs.
- `userId` comes from the authenticated session, **never** from request input.
- Validate every external input with zod at route handlers, server actions, and webhooks.
- n8n webhooks handle non-2xx, timeouts, and retries explicitly.
- Keep CSP tight; never leak the internal vendor map in headers. No secrets in git (`.env*` untracked).
- Env vars: `docs/agents/env-vars.md` is the source of truth — add `process.env.X` to code and to
  that table **in the same PR**. The Stripe webhook verifies the **raw** body before any DB access
  (fail-closed 400).

```ts
// ✗ trusts the client, bypasses RLS
const { userId } = input
// ✓ authoritative identity, RLS enforced
const { data: { user } } = await supabase.auth.getUser()
```

## 4 · Code conventions

- TypeScript strict; no `any`; no `@ts-ignore` without a one-line reason.
- Prefer Server Components; reach for Client Components only when interactivity needs it.
- **Typed event names only** — `FurqanEvent` (from `src/lib/automation/emit.ts`), no raw strings.
  Same for analytics: PostHog + Mixpanel both run (fail-soft, env-gated); Mixpanel events come from
  `MIXPANEL_EVENTS` (`src/lib/mixpanel-server.ts` server-side, `src/lib/mixpanel-client.ts` client),
  autocapture/session-recording stay OFF (students may be minors).
- Progress is **merged, never overwritten** — never silently lose, reset, or overstate memorization.
  Write tests for the scheduler.
- Every component must render correctly in Arabic RTL — test it, don't assume.
- **Migrations are expand/contract (backward-compatible).** On a push to `main` the migration and the
  Vercel build deploy **concurrently, with no ordering gate**, so a migration must never break the
  running build: no `DROP`/`RENAME COLUMN`, no narrowing a type, no `SET NOT NULL` without a default,
  no removing a value still read by live code. Contract in a **later** PR, after the old shape is gone
  from production. CI (`scripts/check-migration-safety.sh`) blocks the structural breakers it can
  detect; the semantic case — removing a value still read by live code — stays your responsibility.
  Deliberate contract-phase opt-out: `-- expand-contract-ok: <reason>` in that migration file.

## 5 · Commands

Confirm exact names against `package.json` first.

```bash
npm install
npm run dev               # next dev
npx tsc --noEmit          # typecheck — MUST pass before "done" (no script)
npm run lint              # eslint — MUST pass
npm run build             # next build
npm run test:unit         # vitest — fast; run per task
npm test                  # playwright e2e — slower; before merge
npm run db:types          # regenerate Supabase types after a migration
npm run sb:advisors       # Supabase security/perf advisors (security lens)

supabase start
supabase db diff -f <name>   # never hand-edit the DB outside migrations
supabase migration up
```

## 6 · Project map

```
src/app/admin/**                 Admin dashboard
src/app/teacher/**               Teacher dashboard
src/app/student/**               Student dashboard
src/app/(public)/**, (auth)/**   Public & auth UI
src/app/api/**                   API routes
src/lib/actions/**, domains/**   Service & domain layer
supabase/migrations/**           Data layer  (+ src/types/database.ts)
specs/**                         speckit specs / plans / tasks
.claude/skills/**                agent skills
e2e/, **/*.test.ts               tests
.github/workflows/**, scripts/   CI / infra
```

## 6.1 · Agent navigation & token efficiency

**Large files — never read wholesale (query a symbol or a narrow range instead):**
- `src/types/database.ts` (~6.8k lines) — a **hand-corrected** types layer, NOT a stale dup of the
  generated file. Read only the alias section at the end. Never collapse/blind-regen it — see
  `specs/026-database-types-drift-guard/spec.md`.
- `src/types/supabase.generated.ts` (~7.4k lines) — raw codegen; only the client reads it.
- `src/lib/dashboard-queries.ts` (~1.7k lines) — legacy god module; per-screen read bundles live in
  `src/lib/views/{student,teacher}-dashboard.ts` (injected client = test seam).

**Symptom → where to look:**
- billing / checkout / subscription → `src/lib/domains/billing/**` (the webhook route is a thin
  verify+dispatch shell; handlers in `webhook-handlers.ts`).
- booking allowed? credits/paywall? → `src/lib/domains/booking/actions.ts` — fail-closed
  active-package precondition.
- a dashboard read → `src/lib/views/*-dashboard.ts`.
- teacher-dashboard server actions → `src/lib/actions/teacher-{booking,session}.ts`, re-exported via
  the `app/teacher/dashboard/actions.ts` barrel (the barrel carries **no** `"use server"` — leaf
  files own it).
- why did a widget fail? → `logError` tags every failure with `route` + `widget`; grep the tag.

**Verify before "done":** run `npm run build`, not just `tsc` — `tsc` doesn't model the server/client
boundary, so it can pass while Turbopack fails. CI's coverage gate excludes `src/app/api/**`, so
relocating code into `src/lib` can drop coverage below threshold.

## 7 · Dual-agent workflow (speckit)

Handoff lives in `specs/<NNN>-<feature>/` (`spec.md` → `plan.md` → `tasks.md`).
**Architect (Claude)** writes spec/plan/tasks through the three lenses — no code.
**Builder (Codex — OpenAI `gpt-5.5`)** executes `tasks.md` in order, typecheck + lint + tests per
task — no scope expansion; stop and list any deviation. **Reviewer (Claude)** diffs against `tasks.md` + the three
lenses → fix checklist, no edits. Commit the plan first; commit between handoffs; one agent edits at
a time. (GitNexus usage rules live in the tool-managed block below.)

## 8 · Never

Modify Quran text · disable or bypass RLS · expose the service-role key client-side · trust `userId`
from input · commit secrets or `.env*` · edit a symbol without `gitnexus_impact` · mark work "done"
with a failing typecheck, lint, or test.

## 9 · PR workflow

1. **Branch from `origin/main`, never local `main`:** `git fetch origin && git checkout -b <name> origin/main`.
2. **Rebase onto `origin/main` immediately before every push and `gh pr create`** — satisfies the
   "branch up to date" protection rule *before* CI runs instead of discovering a blocked merge after.

---
<!-- Tool-managed blocks regenerate below this line — keep everything above intact. -->
<!-- BEGIN:nextjs-agent-rules --><!-- END:nextjs-agent-rules -->
<!-- SPECKIT START -->Current plan: specs/036-teacher-marketplace/plan.md<!-- SPECKIT END -->

<!-- lean-ctx -->
## lean-ctx

lean-ctx is active — the MCP tools replace native equivalents.
Full rules: LEAN-CTX.md (open on demand — do not auto-load).
<!-- /lean-ctx -->

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **furqan** (9520 symbols, 19059 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/furqan/context` | Codebase overview, check index freshness |
| `gitnexus://repo/furqan/clusters` | All functional areas |
| `gitnexus://repo/furqan/processes` | All execution flows |
| `gitnexus://repo/furqan/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## GBrain Search Guidance (configured by /sync-gbrain)
<!-- gstack-gbrain-search-guidance:start -->

GBrain is set up and synced on this machine. The agent should prefer gbrain
over Grep when the question is semantic or when you don't know the exact
identifier yet.

**This worktree is pinned to a worktree-scoped code source** via the
`.gbrain-source` file in the repo root (machine-local, git-ignored via
`.git/info/exclude`). `gbrain code-def`, `code-refs`, `search`, and `query`
from anywhere under this worktree route to that source by default.

Call-graph queries (`code-callers`/`code-callees`) need a built graph
(`/sync-gbrain --dream`) — but in THIS repo prefer GitNexus `impact`/`context`
for who-calls-what; it is already indexed and richer.

Prefer gbrain when:
- "Where is X handled?" / semantic intent, no exact string yet:
    `gbrain search "<terms>"` or `gbrain query "<question>"`
- "Where is symbol Y defined?" / symbol-based code questions:
    `gbrain code-def <symbol>` or `gbrain code-refs <symbol>`
- "What did we decide last time?" / past plans, retros, learnings:
    `gbrain search "<terms>"` (curated memory lives in the default source)

Grep is still right for known exact strings, regex, multiline patterns, and
file globs. Run `/sync-gbrain` after meaningful code changes; a machine-wide
`gbrain autopilot` daemon also refreshes indexes on a schedule.

Safety: don't run `/sync-gbrain` while `gbrain autopilot` is active — the
orchestrator refuses destructive source ops when it detects a running
autopilot to avoid racing it.

<!-- gstack-gbrain-search-guidance:end -->
