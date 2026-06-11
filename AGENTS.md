<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Knowledge Graph — Codebase Intelligence

The codebase is indexed as a knowledge graph at `.understand-anything/knowledge-graph.json`.

- **2,048 nodes** (807 files · 774 functions · 209 tables · 189 docs · 34 configs · 20 classes · 14 pipelines)
- **3,943 edges** (1,953 imports · 809 contains · 610 exports · 177 calls · 71 migrates · 65 depends_on)
- **10 architectural layers** — Admin Dashboard, Teacher Dashboard, Student Dashboard, Public & Auth UI, API Routes, Service & Domain Layer, Data Layer, Tests, Infrastructure & CI/CD, Project Support & Tooling
- **15-step guided tour** — starts at README, ends at CI/CD pipeline

## Always Do (Knowledge Graph)

- **Before editing any file:** find its layer in the graph to understand blast radius
- **Architecture questions:** consult `/admin/architecture` or `.understand-anything/knowledge-graph.json`
- **Codebase tour for onboarding:** `/admin/tour` or read the tour steps in `src/data/codebase-tour.ts`
- **Regenerate after large refactors:** run `/understand --full` to rebuild the graph

## Layer Quick Reference

| Layer | Nodes | Description |
|-------|-------|-------------|
| Admin Dashboard | 174 | src/app/admin/** |
| Service & Domain | 197 | src/lib/actions/**, src/lib/domains/** |
| Data Layer | 220 | supabase/migrations/**, src/types/database.ts |
| Project Support | 328 | .claude/**, specs/**, docs/** |
| Teacher Dashboard | 87 | src/app/teacher/** |
| Student Dashboard | 69 | src/app/student/** |
| Public & Auth UI | 88 | src/app/(public)/**, src/app/(auth)/** |
| API Routes | 40 | src/app/api/** |
| Tests | 25 | **/*.test.ts, e2e/** |
| Infrastructure | 26 | .github/workflows/**, scripts/** |

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **furqan** (10496 symbols, 16677 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

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

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan: [specs/007-daily-webhooks/plan.md](specs/007-daily-webhooks/plan.md)
<!-- SPECKIT END -->

## Cursor Cloud specific instructions

Single product: one Next.js 16 (App Router, Turbopack) + React 19 web app. Backend is a **hosted Supabase** project — there is no local DB to stand up. Dependencies are installed by the startup update script (`npm install`); the notes below are durable run/caveat context, not install steps.

### Node version
- The repo targets **Node 24** (`package.json` `engines`, `.nvmrc`). The VM's default `node` on `PATH` is **Node 22** (`/exec-daemon/node`, hard-coded ahead of nvm). There is no `engine-strict`, so install/lint/test/build/dev all work on Node 22.
- To run on Node 24 (matches production), prepend the nvm bin for the shell: `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`. A `~/.bashrc` entry attempts this but `/exec-daemon` may re-win PATH order, so prefer the explicit export in the command when version parity matters.

### Backend / env (the main caveat)
- The app needs a hosted Supabase project; **`supabase db reset` / a local stack will NOT work** — the repo has no from-scratch baseline (the earliest migration in `src/lib/supabase/migrations/v9_001_schema.sql` starts with `ALTER TABLE profiles ...`; base tables predate the committed migrations in both `supabase/migrations/` and `src/lib/supabase/migrations/`).
- `.env.local` (git-ignored) drives config. Real values for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (and `DAILY_API_KEY` for video) are required for any auth/data flow (register, login, booking, teacher list, dashboards).
- Without real creds, `npm run dev` still boots and **public pages render** (landing, `/teachers`, `/register`, `/login`); data fetches degrade gracefully via `loadOrFail` (e.g. `/teachers` shows "0 teachers"). Placeholder env values are enough to boot public pages and to run `npm run build`. Full reference table: `docs/agents/env-vars.md`.

### Commands (run from repo root)
- `npm run dev` — dev server on `http://localhost:3000` (Turbopack).
- `npm run build` — production build (succeeds with placeholder env; nearly all routes are dynamic/server-rendered).
- `npm run lint` — ESLint.
- `npm run test:unit` — Vitest (pure domain/unit; no env needed). `npm run test:coverage` for coverage.
- `npm test` — Playwright e2e; needs a running app, real backend, and `npx playwright install` (browser download is skipped during `npm install` via `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).
