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
