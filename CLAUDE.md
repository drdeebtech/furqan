@AGENTS.md

# currentDate
Today's date is 2026-05-12.

# Git Identity Rule
Before ANY commit:
```
git config user.email "drdeebtech@gmail.com"
git config user.name "drdeebtech"
```
Vercel Hobby blocks deployments from unrecognized git authors on private repos. Do NOT rely on the machine default identity.

# Deployment Rules
- **Platform**: Vercel Hobby → furqan.today
- **Node**: 24.x (`.nvmrc`, `package.json` `engines`, Vercel project setting — all aligned 2026-04-27)
- After push: `npx vercel ls furqan --prod`. If "Blocked", check git author email.
- `vercel.json` has `installCommand: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install"` — do not remove.
- Edge functions in `supabase/functions/` are excluded from `tsconfig.json` (Deno imports).
- **Cron jobs go on n8n, not Vercel.** Hobby caps `vercel.json` crons at one/day per entry; sub-daily entries cause silent rejection of every subsequent build (invisible in `vercel ls`). Keep route handlers under `src/app/api/cron/*/route.ts` with the dual-auth `Authorization: Bearer ${CRON_SECRET}` + `X-N8N-Secret: ${N8N_WEBHOOK_SECRET}` pattern (canonical: `audit-cleanup/route.ts`); trigger from n8n. Current daily Vercel crons (audit-cleanup, reconciliation, email-health) stay; do not add new ones unless schedule is exactly daily.

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

**Conflict / drift policy:** if a plan, PR, ADR, slash command, or agent recommendation conflicts with the 50k target — **stop and notify the operator.** State the conflict, name the 50k-fitting alternative, ask before continuing. Examples: synchronous third-party API per render; unbounded scan / low-selectivity unique index in a migration; scheduled unbounded UPDATE on schedule/evaluation/progress tables; spec implicitly assuming "few hundred users"; option-A vs option-B identical at small scale but A becomes a write storm at 50k.

**Cross-references:** `.specify/memory/constitution.md` Additional Constraints mirrors this; memory file `~/.claude/projects/-Users-drdeeb-furqan/memory/project_furqan_scale.md` carries it forward; supersedes any older sizing assumption in `.impeccable.md`, `ROADMAP.md`, or pre-50k docs.

# Branch Hygiene Rule (NON-NEGOTIABLE)

Every branch ends in a PR or a deletion — no third state. The 2026-05-08 audit closed PRs #217/#218 and deleted ~33 stale branches; the rule below prevents recurrence.

**The four don'ts:**
1. **Don't commit on whatever branch is checked out.** Always: `git checkout main && git pull --ff-only && git checkout -b <name>` before new work. The 2026-05-07 fix-189 cast-cleanup ended up on a branch labeled "B3.4 design" because of this.
2. **Don't make "v2" branches.** If a branch is going stale, push it as a draft PR or delete it. The 2026-05-08 audit found three `audit-v*` branches racing identical SHAs — none shipped.
3. **Don't push speculative WIP without same-day PR.** A WIP commit that lives only locally 2+ days is for the bin. A 406-line image-captioning edge function sat as `wip/parallel-work-checkpoint` for 2 days and was dropped at audit time. If unsure it's shippable, don't commit; if you commit, draft PR same day.
4. **Don't fix the same thing twice without checking the first attempt.** The 2026-05-08 audit found 8 re-fix-without-checking cases (e.g. `fix/auth-smoke-vercel-bypass` would have re-introduced what PR #121 deliberately removed).

**Pre-work checks** (30 seconds; catches every case):
```bash
gh issue view <N>                                  # still open?
gh pr list                                         # in-flight PR?
git log main --oneline --grep="<topic>"            # shipped under another PR?
git log main --diff-filter=D --oneline -- <file>   # was the file deliberately removed?
```
The fourth check is the one that catches *retired* work — code on main, then deliberately deleted. Without it, "not on main" looks identical to "greenfield."

**Same-day discipline:** push + open draft PR same day. Use `Closes #N` / `Fixes #N` / `Resolves #N` in the body so issue auto-closes on merge. Repo has `delete_branch_on_merge: true` — never re-push to a merged branch.

**Conflict / drift policy:** if you're about to commit on the wrong branch, make a `v2`, push WIP without same-day PR, or fix something without the four checks — **stop and notify the operator.** State conflict, suggest alternative, ask before continuing.

**Cross-references:** `.specify/memory/constitution.md` mirrors this; memory file `~/.claude/projects/-Users-drdeeb-furqan/memory/feedback_branch_hygiene.md` carries it forward.

# Project Reference

FURQAN Academy — Online Quran teaching platform (V13/V17). Full descriptive snapshot (stack, roles, domain ownership, database tables, enums, SQL functions, events catalog, n8n workflow registry, file structure, completed features, remaining work, docs index): **`docs/agents/project-reference.md`**. Deep references: `PROJECT.md`, `SCHEMA_FINAL.md`, `AUTOMATION_REGISTRY.md`, `EVENT_CATALOG.md`, `ROADMAP.md`, `.impeccable.md`.

**Roles (3, per ADR-0003):** student · teacher · admin. The moderator role was dropped 2026-05-08; legacy `/moderator/*` URLs 301-redirect to `/admin/*` (`/moderator/cv-review` → `/admin/teachers/cv`). Use `is_admin()` only — `is_moderator()` and `is_admin_or_mod()` no longer exist.

## Key Architecture
- **Route protection**: `src/proxy.ts` — role middleware + legacy moderator redirects.
- **Server actions**: `"use server"` + `revalidatePath`; `as never` for Supabase `.insert/.update/.upsert` (migrating to typed-helpers per ADR-0002).
- **Admin client**: `src/lib/supabase/admin.ts` — service-role.
- **Feature flags**: `src/lib/settings.ts` + `platform_settings` table.
- **Notifications**: `src/lib/notifications/dispatcher.ts` (multi-channel + quiet hours + `message_delivery_log`); parent reports in `src/lib/notifications/parent.ts`.
- **Event emission**: `src/lib/automation/emit.ts` (non-blocking webhooks → n8n).
- **n8n integration**: REST client `src/lib/n8n/client.ts`; callback `src/app/api/webhooks/n8n/route.ts`; control panel `/admin/n8n`; instance `n8n.drdeeb.tech` on Mac mini (44+ active FURQAN workflows).
- **Telegram bot**: @furqantoday_bot — alerts, failure notifications, admin digests.
- **Admin control tower**: `/admin/control-tower` — 7 real-time operational widgets.
- **Follow-up state machine**: `src/lib/actions/homework.ts` (5 actions, auto-regeneration).
- **Session observation**: Daily.co observer tokens, mic/camera off, max_participants=3.
- **PWA**: `public/sw.js` + install prompt.

More file-path detail in `docs/agents/project-reference.md` § File Structure.

## Environment Variables

All env vars declared in **`docs/agents/env-vars.md`** (variable → purpose). **Rule:** if you add `process.env.X` to code, add `X` to that table in the same PR. Verify with `npx vercel env ls`.

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

## Docs map

File tree, completed features, remaining work, full docs index all in `docs/agents/project-reference.md`. Deep references when needed: `PROJECT.md`, `ROADMAP.md`, `EVENT_CATALOG.md`, `LIFECYCLES.md`, `automation/BLUEPRINT.md`, `.specify/memory/constitution.md`, `specs/INDEX.md`, `specs/<feature>/spec.md`.

> **Design rule:** before touching any visual surface (component, page, theme, color), open `.impeccable.md` and confirm alignment with the **Premium · Refined · Authentic** personality and the four anti-references. The platform serves all ages from children to hāfiz; the brand stays dignified across all.

## Spec-Kit Workflow

Net-new features run through spec-kit before implementation; mid-implementation pivots and refactors stay as ADRs.

**Spec-kit when:** new owner-domain or role surface · P0/P1 roadmap scope · multi-PR effort · ambiguity that needs flushing pre-code.
**ADR-only when:** refactoring existing code · mid-implementation pivot · hotfix / single-PR · documenting a call-decision.

Both can coexist for one feature; `spec.md` may cite ADRs and vice versa.

**Commands:** `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` (checked against `.specify/memory/constitution.md`) → `/speckit.tasks` → `/speckit.analyze` → `/speckit.implement`. Constitution amendments require a PR per its Governance section.

**Index of all specs**: `specs/INDEX.md` is auto-generated by `scripts/generate-specs-index.ts` (husky pre-commit + n8n nightly 03:00 UTC). Read INDEX.md first to find feature lifecycle status — beats `ls specs/` + grep. First worked example: `specs/001-murajaah-scheduler/spec.md` (PR #221).

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

**Migration:** 60+ existing silent-fail sites being migrated incrementally; new code MUST follow the patterns above; reviewers reject any new silent fail.

## Sentry ↔ Git commit convention

When a commit fixes a Sentry issue, include `Fixes JAVASCRIPT-NEXTJS-E4-<N>` in the commit message body (or PR title/description). `Fixes` / `Resolves` / `Closes` all work. Release tagging via `withSentryConfig` in `next.config.ts` (`release.setCommits.auto: true`); fires once the commit lands on `main` and the next Vercel build ships.

Find the short ID in the Sentry issue header (e.g. `JAVASCRIPT-NEXTJS-E4-NN`).

**Auto-resolve currently broken** — see `docs/runbooks/sentry-auto-resolve-fix.md`. Two PRs (#78, #146) shipped the keyword and merged but didn't auto-resolve; diagnosis 2026-05-12 found releases are created but the GitHub integration likely lacks org-level repo read access, so commit lists on releases are empty. Until operator runs the runbook, manually resolve via Sentry MCP `update_issue` on every `Fixes JAVASCRIPT-NEXTJS-…` PR.

DSN one-time activation: `docs/runbooks/sentry-activation.md`.

## Database Migrations Policy

⚠️ **The Supabase Branching GitHub integration silently skips applies more than once a month** (incidents: 2026-04-26..27, 2026-05-01..02, 2026-05-03). Each time, the SQL never runs, the tracker never updates, no error surfaces — you only find out when prod code SELECTs missing columns. **Do not trust the integration as source of truth.**

`.github/workflows/supabase-migrate.yml` is the source of truth: runs `supabase db push --linked` on every push to `main` touching `supabase/migrations/**`, plus dry-run on every PR. A failed push is a failed CI step. The Branching integration is left enabled as belt-and-suspenders.

**Required secret:** `SUPABASE_DB_PASSWORD`. Without it, the workflow fails fast pointing at Supabase Dashboard → Project Settings → Database → Connection string:
```bash
gh secret set SUPABASE_DB_PASSWORD
```
If the workflow is red on `main`, check `gh secret list` first.

### New migrations
```bash
./scripts/new-migration.sh add_session_tags
# → supabase/migrations/<UTC timestamp>_add_session_tags.sql
```
Edit, commit, push to `main`. Tracked in `supabase_migrations.schema_migrations`; **don't** add the legacy `insert into public.schema_migrations` footer.

Optional local dry-run: `npx supabase db push --linked --dry-run`.

### Existing v* migrations
The 30+ files at `src/lib/supabase/migrations/v*.sql` stay where they are — already applied to production via `public.schema_migrations`. Invisible to `supabase migration list --linked` (different naming/location/tracker). Don't migrate them; schema is already there.

### Manual / hotfix path
```bash
npx supabase db query --linked --file <path/to/file.sql>
```
Uses Management API via `supabase login` session. Bypasses both trackers — use sparingly + commit the file afterward.

### Detecting drift
- `npx supabase migration list --linked` — timestamped files only (Local vs Remote).
- For v* files: `select version from public.schema_migrations order by version`.
- CI runs `supabase db lint --linked` on every PR (`.github/workflows/supabase-lint.yml`) — catches syntax, NOT un-applied migrations.

## Preview database isolation — known gap (P2)

All three Vercel environments (Production, Preview, Development) currently point at the same Supabase project (`xyqscjnqfeusgrhmwjts`). Preview deployments share `SUPABASE_SERVICE_ROLE_KEY` with Production — any preview URL has full write access to the production database.

**Until Supabase Branching is set up, treat every preview URL as production for data-mutation testing.** Don't on a preview: deletes, bulk updates, payment flows, role changes, cron-trigger curls, anything that writes to `audit_log` — unless you'd do it on `www.furqan.today`. CI jobs against preview see real production data. There's no environment guard in code; only signal is the deployment URL.

Long-term fix: Supabase Branching for Preview — tracked in `docs/agents/project-reference.md` § Infrastructure improvements.

## Supabase Auth — leaked password protection

One-time HIBP toggle: `docs/runbooks/supabase-leaked-password.md`.

## Supabase MCP — wrong-account gotcha

`mcp__claude_ai_Supabase__*` tools (and host `supabase` CLI) authenticate to the user's **primary** account, which is NOT FURQAN's owner. FURQAN lives under `alforqan.egy@gmail.com`; MCP sees `Dr Deeb Urology Clinic` instead.

**Consequences:** `list_projects`, `get_advisors`, `execute_sql`, `get_logs`, `apply_migration` silently target the wrong project. For audits/advisors/one-off SQL on FURQAN, use the browser dashboard signed in as `alforqan.egy@gmail.com`, or generate a personal access token under that account and pass via `--token` / `SUPABASE_ACCESS_TOKEN`.

Full account-switch procedure: `docs/runbooks/supabase-mcp-account-switch.md`.

## Verification Checklist
After any code change:
1. `npx next build` — zero errors.
2. `npm run lint` — no new errors.
3. `npx playwright test` — all existing tests pass.
4. `npx vercel ls furqan --prod` — deployment succeeds.

## Agent skills

- **Issue tracker** — GitHub issues at `github.com/drdeebtech/furqan/issues` via `gh` CLI. See `docs/agents/issue-tracker.md`.
- **Triage labels** — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. The `triage` skill creates the first four on first use; `wontfix` already exists. See `docs/agents/triage-labels.md`.
- **Domain docs** — single-context layout. `CONTEXT.md` and `docs/adr/` at repo root (both lazily populated by `/grill-with-docs`). See `docs/agents/domain.md`.
