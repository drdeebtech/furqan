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

This environment runs the app in **development mode** against a **local Supabase
stack** (Docker). The update script only runs `npm install`; everything below is
started/applied manually per session and is **not** in the update script.

### Toolchain
- **Node 24** is required (`package.json` `engines`). The VM's daemon node is v22
  and sits first in a fresh shell's `PATH`; the agent's `~/.bashrc` prepends the
  nvm Node 24 bin so interactive shells get the right version. If `node -v` shows
  v22, run `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`.
- Docker, the `supabase` CLI, and `psql` are installed in the VM image (not via
  npm). Docker has no systemd here — start the daemon manually if it is not
  running: `sudo bash -c 'nohup dockerd >/var/log/dockerd.log 2>&1 &'` then
  `sudo chmod 666 /var/run/docker.sock` (daemon uses the `fuse-overlayfs`
  storage driver with the containerd snapshotter disabled — see
  `/etc/docker/daemon.json`).

### Start the backend + DB (per session)
1. `export SUPABASE_AUTH_SMTP_PASS=dummy` (config.toml interpolates this; the
   value is unused locally — local mail goes to Mailpit at `http://127.0.0.1:54324`).
2. `supabase start` — boots Postgres/Auth/Storage. Studio: `http://127.0.0.1:54323`.
3. `bash scripts/dev-local-db-bootstrap.sh` — builds the **full schema**. This is
   required: the repo has **no single replayable baseline**, so plain
   `supabase db reset` / `supabase db push` fails on a fresh DB with
   `function is_admin() does not exist`. The script layers
   `src/lib/supabase/schema.sql` (V8 baseline) → `src/lib/supabase/migrations/v9..v16`
   (legacy) → `supabase/migrations/*` (timestamped). It is safe to re-run (it
   resets the DB). See the script header for the local-only workarounds it applies.

### Env + run the app
- `.env.local` points at the local stack (URL `http://127.0.0.1:54321`, plus the
  static local anon/service_role JWT keys, which are the same on every local
  Supabase install). It is gitignored; recreate it from `supabase status` if missing.
- `npm run dev` → `http://localhost:3000` (Turbopack).

### Standard commands (already documented; see `package.json` / `README.md`)
- Lint: `npm run lint` · Unit tests: `npm run test:unit` (Vitest, ~510 pass).
- E2E (`npm test`, Playwright) needs browsers first: `npx playwright install`
  (skipped at install time via `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).

### Gotchas / known non-issues
- **BotID & auth rate limiting are skipped** unless `process.env.VERCEL` is set,
  so local register/login works without bot tokens. Email confirmation is off
  (`config.toml`), so new accounts can log in immediately.
- **New students are intentionally redirected** from `/student/dashboard` to the
  onboarding teacher-selection page (`/student/teachers?new=1`) until they pick a
  teacher. This is by design, not a bug.
- The DB starts with **no seeded teachers/content**, so browse/list pages show
  empty states. Tables like `blog_posts` / `contact_submissions` are not created
  locally (they came from pre-v9 originals absent from the repo); the blog/contact
  marketing pages are not exercisable locally but core flows are unaffected.
- A pre-existing client-side React warning ("Rendered more hooks than during the
  previous render") can appear on some `/student/*` pages; pages still render and
  return 200. This is app code, unrelated to environment setup.
- First request to a route compiles on demand (dev mode) and can take several
  seconds; this can briefly show a browser "page couldn't load" before it loads.
