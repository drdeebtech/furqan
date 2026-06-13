# AGENTS.md — furqan.today

Quran-memorization platform. This file is the contract for every AI agent (Claude Code, opencode/GLM)
in this repo. Read it before any change. `CLAUDE.md` symlinks here, so both tools share one source of truth.

**Stack:** Next.js App Router · TypeScript (strict) · Tailwind · Supabase (Postgres/Auth/RLS/Storage) ·
Stripe · Daily.co · Bunny CDN · Pusher · Sentry · n8n · PWA · full RTL/Arabic · Vercel.

**Heads-up:** this repo runs a modified/canary Next.js — APIs may differ from your training data.
Check `node_modules/next/dist/docs/` before using an unfamiliar Next API.

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

- Quran text and surah/ayah facts are **never generated, edited, or "corrected"** by a model. The canonical structural reference is `src/lib/quran/` (`surahs.ts`, `ayah-counts.ts`), mirrored to the `quran_surahs_reference` table — read from there; never hardcode counts elsewhere. Any rendered ayah text must come only from a verified source, never a model.
- `surah:ayah` must be exact; validate ranges against `src/lib/quran/ayah-counts.ts` — already enforced by the `student_progress_ayah_range_guard` migration. Never bypass that guard.
- Preserve tashkeel, tajweed marks, and waqf signs byte-for-byte.
- Speech→text checks compare *against* canonical text; ASR output is never stored as a Quran source.
- Unsure on a fiqh/tajweed point → flag for human review, don't guess.

## 3 · Security — hard lines

- RLS on every table; never disable it; new tables ship their policies in the same migration.
- Service-role key is **server-only**. Never in a client component, `NEXT_PUBLIC_*`, or logs.
- `userId` comes from the authenticated session, **never** from request input.
- Validate every external input with zod at route handlers, server actions, and webhooks.
- n8n webhooks handle non-2xx, timeouts, and retries explicitly.
- Keep CSP tight; never leak the internal vendor map in headers. No secrets in git (`.env*` untracked).

```ts
// ✗ trusts the client, bypasses RLS
const { userId } = input
// ✓ authoritative identity, RLS enforced
const { data: { user } } = await supabase.auth.getUser()
```

## 4 · Code conventions

- TypeScript strict; no `any`; no `@ts-ignore` without a one-line reason.
- Prefer Server Components; reach for Client Components only when interactivity needs it.
- **Typed event names only** — one shared enum, no string literals:

```ts
// ✗ pusher.trigger(ch, 'progress-updated', payload)
// ✓ pusher.trigger(ch, Events.ProgressUpdated, payload)
```

- Progress is **merged, never overwritten** — never silently lose, reset, or overstate memorization.
  Write tests for the scheduler.
- Every component must render correctly in Arabic RTL — test it, don't assume.

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

## 7 · Code intelligence (GitNexus)

GitNexus is the canonical navigation layer (MCP tools). **Required:**

- Before editing a symbol → `gitnexus_impact({target, direction:"upstream"})`; report blast radius;
  **stop and warn** on HIGH/CRITICAL risk.
- Explore with `gitnexus_query` instead of grep; full symbol context via `gitnexus_context`.
- Rename only with `gitnexus_rename` (never find-and-replace).
- Before commit → `gitnexus_detect_changes()`. If the index is stale → `npx gitnexus analyze`.
- Deep guides live in `.claude/skills/gitnexus/`.

## 8 · Dual-agent workflow (speckit)

Handoff lives in `specs/<NNN>-<feature>/` (`spec.md` → `plan.md` → `tasks.md`).

1. **Architect (Claude):** write/refine spec → plan → tasks through the three lenses. No code.
2. **Builder (opencode/GLM):** execute `tasks.md` in order; `gitnexus_impact` before edits; run
   typecheck + lint + tests per task; don't expand scope — stop and list any deviation.
3. **Reviewer (Claude):** diff vs `tasks.md` + the three lenses → return a fix checklist. No edits.

Commit the plan first; commit between handoffs; one agent edits at a time.

## 9 · Never

Modify Quran text · disable or bypass RLS · expose the service-role key client-side · trust `userId`
from input · commit secrets or `.env*` · edit a symbol without `gitnexus_impact` · mark work "done"
with a failing typecheck, lint, or test.

---
<!-- Tool-managed blocks regenerate below this line — keep everything above intact. -->
<!-- BEGIN:nextjs-agent-rules --><!-- END:nextjs-agent-rules -->
<!-- gitnexus:start --><!-- gitnexus:end -->
<!-- SPECKIT START --><!-- SPECKIT END -->
