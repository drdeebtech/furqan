@AGENTS.md

# currentDate
Today's date is 2026-06-02.

# Git Identity Rule
Before ANY commit:
```
git config user.email "drdeebtech@gmail.com"
git config user.name "drdeebtech"
```
Vercel Hobby blocks deployments from unrecognized git authors on private repos. Do NOT rely on the machine default identity.

# Deployment Rules
- **Platform**: Vercel Pro (since 2026-05-05; was Hobby) → furqan.today.
- **Node**: 24.x (`.nvmrc`, `package.json` `engines`, Vercel project setting — all aligned 2026-04-27).
- After push: `npx vercel ls furqan --prod`. If "Blocked", check git author email.
- `vercel.json` has `installCommand: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install"` — do not remove.
- Edge functions in `supabase/functions/` are excluded from `tsconfig.json` (Deno imports).
- **Cron jobs go on n8n, not Vercel.** n8n on the Mac mini owns sub-daily schedules. Keep route handlers under `src/app/api/cron/*/route.ts` with the dual-auth `Authorization: Bearer ${CRON_SECRET}` + `X-N8N-Secret: ${N8N_WEBHOOK_SECRET}` pattern (canonical: `audit-cleanup/route.ts`); trigger from n8n.

# Scale Target Rule (NON-NEGOTIABLE)

FURQAN is built for **50,000 users**. Every plan, design, and implementation choice must size for that target — never "today's traffic with retrofit later." Late-stage retrofits at 50k cost dramatically more than getting it right up front.

**Concrete obligations:**
- **Performance budgets** — P95 latency, query plans, dashboard waterfalls, bundle sizes must hold under ~50k DAU. Dev-time perf is not a proxy.
- **Write-amplification audit** — every per-render column update is 250k writes/day at 50k DAU. Reuse columns that already write on that path.
- **No bulk-fan-out admin actions** — admin actions that fan out to N student rows become 10M-row UPDATEs at scale. Change defaults for *new* rows, not retroactively rewrite existing rows.
- **Returning-user UX** — backlog-shaming patterns ("you have 47 things to catch up") kill retention. Default forgiving; route deep gaps to teacher-side panels.
- **Teacher infrastructure is load-bearing** — route falling-behind signals to teachers, don't try to make the app replace them.
- **Cron / batch sizing** — nightly jobs at 50k × ~200 rows/student ≈ 10M row-touches/night. Size n8n, Postgres functions, indexes accordingly. n8n on Mac mini handles sub-daily.
- **Hot-path JOINs** — every dashboard render × ~5 hits/day = 250k reads/day. Each extra JOIN multiplies that. Push provenance/versioning onto the row.
- **RLS at scale** — load-test multi-tenant policies; predicates fine on 100 rows can degrade catastrophically on 10M rows without the right index.

**Conflict / drift policy:** if a plan, PR, ADR, slash command, or agent recommendation conflicts with the 50k target — **stop and notify the operator.** State the conflict, name the 50k-fitting alternative, ask before continuing.

**Cross-references:** `.specify/memory/constitution.md` Additional Constraints mirrors this; memory file `~/.claude/projects/-home-drdeeb-furqan/memory/project_furqan_scale.md` carries it forward; supersedes any older sizing assumption in `.impeccable.md`, `ROADMAP.md`, or pre-50k docs.

# Branch Hygiene Rule (NON-NEGOTIABLE)

Every branch ends in a PR or a deletion — no third state.

**The four don'ts:**
1. **Don't commit on whatever branch is checked out.** Always: `git checkout main && git pull --ff-only && git checkout -b <name>` before new work.
2. **Don't make "v2" branches.** If a branch is going stale, push it as a draft PR or delete it.
3. **Don't push speculative WIP without same-day PR.** If unsure it's shippable, don't commit; if you commit, draft PR same day.
4. **Don't fix the same thing twice without checking the first attempt.**

**Pre-work checks** (30 seconds; catches every case):
```bash
gh issue view <N>                                  # still open?
gh pr list                                         # in-flight PR?
git log main --oneline --grep="<topic>"            # shipped under another PR?
git log main --diff-filter=D --oneline -- <file>   # was the file deliberately removed?
```
The fourth check is the one that catches *retired* work — code on main, then deliberately deleted.

**Same-day discipline:** push + open draft PR same day. Use `Closes #N` / `Fixes #N` / `Resolves #N` in the body so issue auto-closes on merge. Repo has `delete_branch_on_merge: true` — never re-push to a merged branch.

**Conflict / drift policy:** if you're about to commit on the wrong branch, make a `v2`, push WIP without same-day PR, or fix something without the four checks — **stop and notify the operator.** State conflict, suggest alternative, ask before continuing.

**Cross-references:** `.specify/memory/constitution.md` mirrors this; memory file `~/.claude/projects/-home-drdeeb-furqan/memory/feedback_branch_hygiene.md` carries it forward.

# Project Reference

FURQAN Academy — Online Quran teaching platform (V13/V17). Full descriptive snapshot (stack, roles, domain ownership, database tables, enums, SQL functions, events catalog, n8n workflow registry, file structure, completed features, remaining work, docs index): **`docs/agents/project-reference.md`**. Deep references: `PROJECT.md`, `SCHEMA_FINAL.md`, `AUTOMATION_REGISTRY.md`, `EVENT_CATALOG.md`, `ROADMAP.md`, `.impeccable.md`.

**Roles (3, per ADR-0003):** student · teacher · admin. The moderator role was dropped 2026-05-08; legacy `/moderator/*` URLs 301-redirect to `/admin/*`. Use `is_admin()` only — `is_moderator()` and `is_admin_or_mod()` no longer exist.

## Coding Patterns
- All server actions use `"use server"`.
- Supabase writes: prefer `TableInsert<"X">` / `TableUpdate<"X">` from `src/lib/supabase/typed-helpers` over `as never` (per ADR-0002, Phase 4 sweep).
- Use `.returns<Type[]>()` for queries on V10+ tables.
- `useActionState` from `"react"` (NOT `"react-dom"`).
- `startTransition` for setState inside useEffect (React compiler compliance).
- All user-facing text in Arabic; bilingual labels optional (Arabic + English hint).
- `revalidatePath()` after every mutation.
- Audit logging for admin destructive actions.
- **Notifications**: only `notify()` / `dispatchNotification()` — never insert directly into `notifications`.
- **Events**: every state-change server action must call `emitEvent()` from `src/lib/automation/emit.ts`.

## Spec-Kit Workflow

**Spec-kit when:** new owner-domain or role surface · P0/P1 roadmap scope · multi-PR effort · ambiguity that needs flushing pre-code.
**ADR-only when:** refactoring · mid-implementation pivot · hotfix / single-PR.

**Commands:** `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.analyze` → `/speckit.implement`. Check `specs/INDEX.md` first (auto-generated, beats `ls specs/` + grep).

## No Silent Failures Policy

Every DB-write or side-effect server action MUST be loud: user sees the outcome, operator sees the error, audit trail records the attempt.

**Two mandatory primitives:**
- **`loudAction`** (`src/lib/actions/loud.ts`) — wraps the handler; every throw is logged + (if critical) Telegram'd + `audit_log`'d. Returns `{ ok, message?, error? }`.
- **`<ActionFeedback state={...} />`** (`src/components/shared/action-feedback.tsx`) — drop-in renderer for any `loudAction` result. Every form using `useActionState` MUST render it.

**Forbidden:** discarded errors (`await supabase.from(X).insert(... as never)` with no `.error` capture); caught-and-swallowed `try{} catch{}`; form-action returning `{ error }` that the page doesn't render.

**Required (one of):** capture-and-return-error; wrap in `loudAction` for free logging + audit; render `ActionFeedback` in the form.

**Best-effort writes** (`audit_log`, `automation_logs`): keep non-blocking but pipe failures through `logError`:
```ts
await supabase.from("audit_log").insert({...} as never)
  .catch(err => logError("audit insert failed", err, { tag: "audit" }));
```

## Database Migrations Policy

**New migrations:**
```bash
./scripts/new-migration.sh add_session_tags
# → supabase/migrations/<UTC timestamp>_add_session_tags.sql
```
Edit, commit, push to `main`. CI runs `supabase db push --linked` — that is the source of truth. ⚠️ Supabase Branching integration is unreliable (silent skips); do not trust it as source of truth.

> Full detail (v* migrations, manual hotfix path, drift detection, branching gotcha, required secret): `docs/agents/CLAUDE-reference.md`

---

> Reference material (key architecture, env vars, Sentry convention, Supabase MCP gotcha, preview isolation, verification checklist, agent skills): `docs/agents/CLAUDE-reference.md`



## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## PR Babysitting Rule (NON-NEGOTIABLE)

After creating or pushing ANY PR (via /ship, /land-and-deploy, `gh pr create`, or `git push`), always offer to start `/loop` to babysit it until it merges. The loop should monitor: CI status, review comments, merge conflicts, and required approvals. Offer with a one-liner like: "Want me to `/loop` to babysit this PR until it merges?"
