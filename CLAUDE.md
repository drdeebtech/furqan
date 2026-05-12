@AGENTS.md

# currentDate
Today's date is 2026-04-10.

# Git Identity Rule

Before making ANY git commit, you MUST ensure the git author matches the GitHub account:
```
git config user.email "drdeebtech@gmail.com"
git config user.name "drdeebtech"
```
Run this at the start of every conversation before committing. Vercel Hobby plan blocks deployments from unrecognized git authors on private repos. Do NOT rely on the machine default identity.

# Deployment Rules

- **Platform**: Vercel Hobby plan → furqan.today
- **Node version**: 24.x (set in `.nvmrc` and `package.json` `engines`, matching the Vercel project setting). Aligned 2026-04-27 — was previously split (`.nvmrc=20`, project=`24.x`).
- After pushing, verify deployment status: `npx vercel ls furqan --prod`
- If deployment is "Blocked", check git author email matches `drdeebtech@gmail.com`
- The `vercel.json` has `installCommand: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install"` — do not remove this
- Edge functions in `supabase/functions/` are excluded from `tsconfig.json` (Deno imports)
- **Cron jobs go on n8n, not Vercel.** Vercel Hobby caps `vercel.json` crons at one invocation per day per entry — a `*/30 * * * *` (or any sub-daily) entry causes Vercel to silently reject every subsequent build with `"Hobby accounts are limited to daily cron jobs"`, but the rejection is invisible in `vercel ls` (rejected builds never enter the queue), so this looks like a broken GitHub→Vercel webhook. Keep route handlers under `src/app/api/cron/*/route.ts` (the existing dual-auth `Authorization: Bearer ${CRON_SECRET}` + `X-N8N-Secret: ${N8N_WEBHOOK_SECRET}` pattern in `audit-cleanup/route.ts` is the canonical shape) and trigger from n8n on the Mac mini. The current daily Vercel crons (audit-cleanup, reconciliation, email-health) can stay; do not add new ones unless the schedule is exactly daily.

# Scale Target Rule (NON-NEGOTIABLE)

FURQAN is being built for **50,000 users**. Every plan, design, and implementation choice MUST be sized for that number from day one — not for "today's traffic" with a "we'll optimise later" intent. Late-stage retrofitting at 50k user scale is dramatically more expensive than getting it right up front.

**Concrete obligations (apply before agreeing to any approach):**

- **Performance budgets** — P95 latency, DB query plans, dashboard waterfalls, and bundle sizes must hold under ~50k DAU. Don't trust dev-time perf as a proxy.
- **Write-amplification audit** — every "small column we'll update on each request" is a 250k-write/day decision at 50k DAU. Before adding a column that updates per page render, ask whether the same signal exists on a column that's already being written.
- **No bulk-fan-out admin actions** — admin actions that fan out to N student rows turn into 10M-row UPDATEs at scale. Push state to per-row data with localised writes; admin-tunable settings should change defaults for *new* rows only, not retroactively rewrite existing rows.
- **Returning-user UX** — backlog-shaming patterns ("you have 47 things to catch up") destroy retention at scale. Default to forgiving variants; route deep gaps to teacher-side panels rather than student-facing remediation cards.
- **Teacher infrastructure is load-bearing** — when a student falls behind, route the signal to the teacher panel. Don't try to make the app replace a human teacher.
- **Cron / batch sizing** — nightly jobs at 50k × ~200 rows/student ≈ 10M row-touches per night. Size n8n workflows, Postgres functions, and Supabase indexes accordingly. Avoid sub-daily Vercel crons; n8n on the Mac mini handles sub-daily.
- **Hot-path JOINs** — every dashboard render at 50k DAU × ~5 hits/day = 250k reads/day. Each extra JOIN on the hot path multiplies that. Push provenance / versioning columns onto the row itself rather than a join target.
- **RLS at scale** — multi-tenant policies must be load-tested, not just dev-tested. RLS predicates that work fine on a 100-row table can degrade catastrophically on a 10M-row table without the right index.

**Conflict / drift policy:**

If a plan, PR, proposed approach, slash command, or agent recommendation conflicts with the 50k target — **stop and notify the operator before proceeding**. Don't quietly accept a "this is fine for now" path that creates retrofit debt.

Examples of conflicts that warrant notification:
- A new feature that synchronously calls a third-party API per dashboard render.
- A migration that adds an unbounded scan or a unique index on a low-selectivity column.
- An admin action that does an unbounded UPDATE on schedule, evaluation, or progress tables.
- A spec, ADR, or PRD that implicitly assumes "few hundred users" performance.
- Recommended option A vs. B is identical at small scale but A becomes a write storm at 50k.

Notification format: state the conflict explicitly, name the alternative that fits 50k, and ask before continuing. Do NOT silently switch the choice — operator decides.

**Cross-references:**

- `.specify/memory/constitution.md` Additional Constraints section MUST mirror this rule so `/speckit.plan` and `/speckit.analyze` enforce it on every feature spec.
- Memory file `~/.claude/projects/-Users-drdeeb-furqan/memory/project_furqan_scale.md` carries the same rule into future Claude Code sessions.
- This rule supersedes any default sizing assumption in `.impeccable.md`, `ROADMAP.md`, or older docs that predate the 50k commitment.

# Branch Hygiene Rule (NON-NEGOTIABLE)

Every branch ends with a Pull Request OR a deletion. There is no third state. Stale local-only branches that "might be useful later" are how 33+ zombie branches accumulated in this repo before the 2026-05-08 audit; the rule below prevents recurrence.

**The four don'ts (apply to every commit, no exceptions):**

1. **Don't commit on whatever branch happens to be checked out.** Always run `git checkout main && git pull --ff-only && git checkout -b <name>` before starting any new work. The pattern that breaks this rule is how the 2026-05-07 fix-189 cast-cleanup ended up on a branch labeled "B3.4 design"; commits get orphaned and audits can't trace them.

2. **Don't make "v2" branches.** If a branch is going stale, push it as a PR (draft is fine) or delete it. Never make `chore/repo-audit-v2` after `chore/repo-audit-bucket` — the 2026-05-08 audit found three branches of `audit-v*` with identical SHAs racing to ship the same work; none of them did.

3. **Don't push speculative WIP to remote unless you'll PR it the same day.** A WIP commit that lives only locally for 2+ days is WIP for the bin. The image-captioning edge function (406 lines) sat as `wip/parallel-work-checkpoint` for 2 days, then got dropped at audit time because the path-to-ship was never clear. If unsure it's shippable, don't commit; if you commit, open a draft PR same day.

4. **Don't fix the same thing twice without checking the first attempt.** The 2026-05-08 audit found 8 cases of re-fix-without-checking. One of them (`fix/auth-smoke-vercel-bypass`) would have re-introduced a feature that PR #121 explicitly removed as "chronically red." Pre-work check is 30 seconds and catches every case.

**Pre-work checks (run before starting any fix):**

```bash
gh issue view <N>                              # is the issue still open?
gh pr list                                     # is there an in-flight PR?
git log main --oneline --grep="<topic>"        # has it shipped under another PR?
git log main --diff-filter=D --oneline -- <file>   # was it deliberately removed?
```

The fourth check (`--diff-filter=D`) is the one that catches *retired* work — code that was on main, then someone deliberately deleted it. Without that check, "the file isn't on main" looks identical to "this is greenfield work."

**Same-day discipline:**

- Push and open PR (draft is fine) the same day you start coding.
- Use `Closes #N` (or `Fixes`, `Resolves`) in the PR body so the issue auto-closes on merge.
- After merge, GitHub auto-deletes the source branch (`delete_branch_on_merge: true` is enabled at the repo level). Never re-push to a merged branch — name a new one.

**Conflict / drift policy:**

If you find yourself about to: commit on `feat/something-else` instead of a fresh branch; create a `v2` of an existing branch; push WIP without a same-day PR; or start a fix without checking whether it's already shipped or removed — **stop and notify the operator before proceeding.** State the conflict, suggest the alternative, ask before continuing. Do NOT silently work around it.

**Cross-references:**

- `.specify/memory/constitution.md` Additional Constraints section MUST mirror this rule so `/speckit.plan` and `/speckit.analyze` enforce it on every feature spec.
- Memory file `~/.claude/projects/-Users-drdeeb-furqan/memory/feedback_branch_hygiene.md` carries this rule into future Claude Code sessions.
- Audit that surfaced these patterns: 2026-05-08 (closed PRs #217, #218; deleted ~33 stale branches).

# Project Reference (stack, roles, schema, n8n registry, file map, feature status)

FURQAN Academy — Online Quran teaching platform (V13/V17). See `docs/agents/project-reference.md` for the full descriptive snapshot: tech stack, roles, domain ownership table, database tables, enums, SQL functions, events catalog, n8n workflow registry, file structure, completed features, remaining work, docs index. Deep references: `PROJECT.md`, `SCHEMA_FINAL.md`, `AUTOMATION_REGISTRY.md`, `EVENT_CATALOG.md`, `ROADMAP.md`, `.impeccable.md`.

## Key Architecture
- **Route protection**: `src/proxy.ts` — role-based middleware. Legacy `/moderator/*` URLs 301-redirect to `/admin/*` (per ADR-0003); `/moderator/cv-review` → `/admin/teachers/cv` specifically.
- **Server actions**: `"use server"` pattern with `revalidatePath`, `as never` casts for Supabase
- **Admin client**: `src/lib/supabase/admin.ts` — service-role client for user creation
- **Feature flags**: `src/lib/settings.ts` + `platform_settings` table
- **Parent notifications**: `src/lib/notifications/parent.ts` — report system for parents
- **Notification dispatcher**: `src/lib/notifications/dispatcher.ts` — multi-channel with preferences, quiet hours, delivery logging to message_delivery_log
- **Session observation**: Daily.co observer tokens with mic/camera off, max_participants bumped to 3
- **Follow-up system**: `src/lib/actions/homework.ts` — 5 server actions with state machine and auto-regeneration
- **Event emission**: `src/lib/automation/emit.ts` — non-blocking webhooks to n8n with per-event routing
- **n8n callback**: `src/app/api/webhooks/n8n/route.ts` — log, notify, idempotency check
- **n8n REST client**: `src/lib/n8n/client.ts` — workflows, executions, toggle, Telegram alerts
- **n8n control panel**: `/admin/n8n` — view/toggle/search/filter/auto-restart all n8n workflows
- **n8n instance**: n8n.drdeeb.tech (self-hosted on Mac mini) — **44+ active FURQAN workflows** across 9 areas
- **Telegram bot**: @furqantoday_bot — auto-restart alerts, failure notifications, admin digests
- **Notification bell**: `src/components/shared/notification-bell.tsx` — topbar dropdown with unread count
- **Admin control tower**: `/admin/control-tower` — 7 real-time operational widgets with alert badges
- **Teacher action queue**: `src/app/teacher/dashboard/action-queue.tsx` — prioritized pending tasks
- **PWA**: `public/sw.js` — service worker + install prompt

## Environment Variables

All env vars are declared in `docs/agents/env-vars.md` (variable → purpose). **Rule:** if you add `process.env.X` to code, add `X` to that table in the same PR. Run `npx vercel env ls` to verify each is set in Production / Preview / Development.

## Coding Patterns
- All server actions use `"use server"` directive
- Use `as never` for Supabase `.insert()` / `.update()` calls
- Use `.returns<Type[]>()` for queries on V10+ tables
- Use `useActionState` from `"react"` (NOT from `"react-dom"`)
- Use `startTransition` for setState inside useEffect (React compiler compliance)
- All user-facing text in Arabic, bilingual labels optional (Arabic + English hint)
- `revalidatePath()` after every mutation
- Audit logging for admin destructive actions
- **All notifications must go through `notify()` or `dispatchNotification()`** — never insert directly into notifications table
- **All event-emitting server actions must call `emitEvent()`** from `src/lib/automation/emit.ts`

## Docs map

File tree, completed-feature log, remaining work, and the full docs index all live in `docs/agents/project-reference.md`. Deep references when needed: `PROJECT.md`, `ROADMAP.md`, `EVENT_CATALOG.md`, `LIFECYCLES.md`, `automation/BLUEPRINT.md`, `.specify/memory/constitution.md`, `specs/<feature>/spec.md`.

> **Design rule for AI sessions:** before touching any visual surface (component, page, theme, color), open `.impeccable.md` and confirm the change aligns with the **Premium · Refined · Authentic** personality and the four explicit anti-references. The platform serves all ages from children to hāfiz; the brand stays dignified across all of them.

## Spec-Kit Workflow

Net-new features run through spec-kit before implementation; emergent architectural decisions during implementation continue to land as ADRs.

**Use spec-kit when:**
- Introducing a new owner-domain or a new role surface.
- Roadmap-level scope (P0/P1 in `ROADMAP.md`) or multi-PR effort.
- A feature whose ambiguity needs to be flushed before code lands.

**Use ADR-only when:**
- Refactoring existing code (e.g. ADR-0002, ADR-0004).
- Mid-implementation pivot or unforeseen constraint.
- Hotfix or single-PR fix.
- Documenting a decision the team made on a call.

**Cross-reference:** a `spec.md` may cite ADRs it depends on; an ADR may cite the spec it implements (`specs/<feature>/spec.md`). Both can coexist for one feature without duplication.

**Workflow:**
1. `/speckit.specify "<one-paragraph feature description>"` — generates `specs/<NNN-feature-slug>/spec.md` on a fresh feature branch.
2. `/speckit.clarify` — interactive 5-question pass that closes spec gaps.
3. `/speckit.plan` — produces `plan.md`, `research.md`, `data-model.md`, `contracts/`. The plan is checked against `.specify/memory/constitution.md`.
4. `/speckit.tasks` — emits dependency-ordered `tasks.md`.
5. `/speckit.analyze` — non-destructive cross-artefact consistency check.
6. `/speckit.implement` — executes tasks one by one against the codebase.

The constitution lives at `.specify/memory/constitution.md`. Amendments require a PR per its Governance section. The first worked example is `specs/001-murajaah-scheduler/spec.md` (PR #221 renames it from the original `specs/murajaah-scheduler/`).

**Index of all specs**: `specs/INDEX.md` is auto-generated by `scripts/generate-specs-index.ts` (regenerated by husky pre-commit on `specs/**/*.md` changes and by an n8n nightly cron at 03:00 UTC). Read INDEX.md first to find the lifecycle status of any feature spec — beats `ls specs/` + per-folder grep.

## No Silent Failures Policy

Every server action that writes to the DB or has side-effects MUST be loud: the user sees the outcome, the operator sees the error, and the audit trail records the attempt.

**Two mandatory primitives:**
- **`loudAction`** from `src/lib/actions/loud.ts` — wraps the handler so every throw is logged + (if critical) Telegram'd + audit_log'd. Returns `{ ok, message?, error? }`.
- **`<ActionFeedback state={...} />`** from `src/components/shared/action-feedback.tsx` — drop-in renderer that shows green/red banner from any `loudAction` result. Every form using `useActionState` MUST render it.

**Forbidden anti-patterns:**

```ts
// ❌ Silent fail: discarded error.
await supabase.from("teacher_profiles").insert({ ... } as never);

// ❌ Caught and swallowed.
try { await x.update(...); } catch { /* ignored */ }

// ❌ Form returns { error } but page doesn't render it.
const [state, formAction] = useActionState(myAction, null);
return <form action={formAction}>{/* no error display */}</form>;
```

**Required patterns:**

```ts
// ✅ Capture the error, return it to the caller.
const { error } = await supabase.from("teacher_profiles").insert({ ... } as never);
if (error) return { error: `فشل: ${error.message}` };

// ✅ Or wrap in loudAction for free logging + audit.
export const archiveTeacher = loudAction({
  name: "admin.archive-teacher",
  severity: "warning",
  audit: { table: "teacher_profiles", recordId: i => i.teacherId, action: "UPDATE" },
  handler: async ({ teacherId }) => {
    const { error } = await supabase.from("teacher_profiles").update(...).eq(...);
    if (error) throw error;
    return { message: "تم الأرشفة" };
  },
});

// ✅ Form renders ActionFeedback.
return <form action={formAction}><ActionFeedback state={state} />...</form>;
```

**Best-effort writes (audit_log, automation_logs)** — keep them non-blocking but pipe failures through `logError` so they're visible:

```ts
await supabase.from("audit_log").insert({...} as never)
  .catch(err => logError("audit insert failed", err, { tag: "audit" }));
```

**Migration plan**: existing 60+ silent-fail call sites are being migrated incrementally. New code MUST follow the patterns above. Reviewers should reject any PR introducing a new silent fail.

## Sentry ↔ Git commit convention

When a commit fixes a Sentry-reported issue, **include `Fixes JAVASCRIPT-NEXTJS-E4-<N>`** in the commit message body (or PR title/description). Sentry's GitHub integration auto-resolves the matching issue when the next release tagged on `main` contains the commit. Release tagging is owned by the `@sentry/nextjs` plugin (`withSentryConfig` in `next.config.ts`), which runs `release.setCommits.auto: true` during the Vercel build — no separate script involved.

Example:
```
fix(og): wrap blog OG image in try/catch + fallback + 24h cache

Fixes JAVASCRIPT-NEXTJS-E4-3
```

Find the short ID in the Sentry issue header (looks like `JAVASCRIPT-NEXTJS-E4-NN`). Keywords `Fixes`, `Resolves`, and `Closes` all work. The convention only kicks in once the commit lands on `main` and the next Vercel build ships — local commits don't trigger it.

## Database Migrations Policy

⚠️ **The Supabase Branching GitHub integration silently skips applies more than once a month** (incidents: 2026-04-26..27, 2026-05-01..02, 2026-05-03). Each time, the SQL never runs and the tracker never updates, but no error surfaces — you only find out when prod code SELECTs columns the schema doesn't have. **Do not trust the integration as the source of truth.**

The `.github/workflows/supabase-migrate.yml` workflow is now the source of truth. It runs `supabase db push --linked` on every push to `main` that touches `supabase/migrations/**`, and a dry-run on every PR. A failed push is a failed CI step that you can read, fix, and re-run. The Branching integration is left enabled as belt-and-suspenders but is no longer load-bearing.

**Required secret to make the workflow actually run:** `SUPABASE_DB_PASSWORD`. Without it, every run of `supabase-migrate.yml` fails fast with a pointer to the Supabase Dashboard → Project Settings → Database → Connection string. Set once with:

```bash
gh secret set SUPABASE_DB_PASSWORD
# paste the Postgres password at the prompt
```

If you see this workflow red on `main`, the secret is missing — the migrate is then quietly falling back to the Branching integration (the same vulnerability the workflow was meant to close). Check `gh secret list` first before debugging anything else.

### Going forward — new migrations

Use the helper script:

```bash
./scripts/new-migration.sh add_session_tags
# → creates supabase/migrations/<UTC timestamp>_add_session_tags.sql
```

Then edit the file with your DDL, commit, push to `main`. The `Supabase Migrate` GitHub Action runs `supabase db push --linked` and verifies the tracker. PRs get a dry-run preview that shows exactly what would apply.

New migrations are tracked in `supabase_migrations.schema_migrations` (Supabase's internal tracker) — **don't** add the `insert into public.schema_migrations` footer that the v* files use.

Optional local dry-run before push:
```bash
npx supabase db push --linked --dry-run
```

### Existing v* migrations

The 30+ files at `src/lib/supabase/migrations/v*.sql` all stay where they are — they're already applied to production via the project's own `public.schema_migrations` table. They're invisible to `supabase migration list --linked` (different naming, different location, different tracker). That's fine — don't try to migrate them across; the schema is already there.

### Manual / hotfix path (still works)

For migrations that need to bypass GitHub (e.g. a fix you want immediately), run any SQL file directly:

```bash
npx supabase db query --linked --file <path/to/file.sql>
```

This uses the Management API via your `supabase login` session. Bypasses both trackers, so use sparingly + remember to commit the file afterward so future readers see what changed.

### Detecting drift

- `npx supabase migration list --linked` shows **timestamped** files only (Local vs Remote columns). Use it to confirm a new migration applied.
- For the v* files, `select version from public.schema_migrations order by version` is the source of truth.
- CI runs `supabase db lint --linked` on every PR (`.github/workflows/supabase-lint.yml`) — catches syntax issues, does NOT catch un-applied migrations.

## Preview database isolation — known gap (P2)

All three Vercel environments (Production, Preview, Development) currently point at the same Supabase project (`xyqscjnqfeusgrhmwjts`). Preview deployments share `SUPABASE_SERVICE_ROLE_KEY` with Production, so any preview URL has full write access to the production database — RLS-bypassing inserts, updates, and deletes will all hit real rows.

**Until Supabase Branching is set up, treat every preview URL as production for the purposes of data-mutation testing.** Concrete don'ts on a preview deploy: do not test deletes, bulk updates, payment flows, role changes, cron-trigger curls, or anything that writes to `audit_log` unless you would do the same on `www.furqan.today`. Any CI job that runs against a preview sees real production data.

Detection is implicit — there's no environment guard in code that distinguishes Preview from Production. The only signal is the deployment URL itself. If a future migration or feature needs a sandbox, request a fresh Supabase project and a separate `*_PREVIEW` env var set, or wait for Branching (see Remaining Work).

Long-term fix: enable Supabase Branching for Preview so each PR auto-spins an ephemeral, isolated database that mirrors prod schema. Tracked in Remaining Work → Infrastructure improvements.

## Sentry GitHub auto-resolve — currently broken (follow-up)

> One-time DSN activation steps: `docs/runbooks/sentry-activation.md`.
> **Auto-resolve fix runbook: `docs/runbooks/sentry-auto-resolve-fix.md`** — operator action required (install Sentry GitHub App at org level, link `drdeebtech/furqan`).

Two PRs in a row (PR #78, PR #146) shipped `Fixes JAVASCRIPT-NEXTJS-E4-<N>` keywords and merged to `main` with a successful Vercel build, yet Sentry did NOT auto-resolve the referenced issues. Diagnosis confirmed on 2026-05-12: releases are being created (`setCommits: { auto: true }` is configured + `SENTRY_AUTH_TOKEN` is set in Vercel Production) but the GitHub integration likely isn't granting the org read access to the repo, so the commit list on each release is empty and the keyword has nothing to match.

Until the operator runs the runbook above, manually resolve via the Sentry MCP `update_issue` tool (status `resolvedInNextRelease` or `resolved`) on every PR that ships a `Fixes JAVASCRIPT-NEXTJS-...` keyword.

## Supabase Auth — leaked password protection

One-time HIBP toggle steps are in `docs/runbooks/supabase-leaked-password.md`.

## Supabase MCP — wrong-account gotcha

The `mcp__claude_ai_Supabase__*` tools (and the `supabase` CLI when logged in via the host machine) are authenticated to the user's *primary* Supabase account, which is **not** the account that owns the FURQAN database. FURQAN's project lives under a separate account (`alforqan.egy@gmail.com`); MCP only sees `Dr Deeb Urology Clinic`.

**Consequences:**
- `list_projects`, `get_advisors`, `execute_sql`, `get_logs`, `apply_migration` and friends silently target the **wrong project** if called blindly. They will return data for the urology clinic schema, not FURQAN.
- The CLAUDE.md instruction to "Re-run `get_advisors`" only works if FURQAN's account is added to MCP/CLI auth. Until that's wired up, treat all Supabase verification steps as "browser only".

**For audits / advisors / one-off SQL on FURQAN**: open the dashboard at https://supabase.com/dashboard signed in as `alforqan.egy@gmail.com`. For programmatic access, generate a personal access token under that account and use the `supabase` CLI with `--token`, or set `SUPABASE_ACCESS_TOKEN` in a shell-scoped env var.

## Verification Checklist
After any code change:
1. `npx next build` — must pass with zero errors
2. `npm run lint` — no new errors
3. `npx playwright test` — all existing tests pass
4. `npx vercel ls furqan --prod` — verify deployment succeeds

## Agent skills

### Issue tracker

Issues live as GitHub issues at `github.com/drdeebtech/furqan/issues`, accessed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. The first four don't exist on the repo yet — the `triage` skill creates them on first use; `wontfix` already exists. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. `CONTEXT.md` and `docs/adr/` at the repo root (both empty for now; `/grill-with-docs` populates them lazily as terms and decisions resolve). See `docs/agents/domain.md`.
