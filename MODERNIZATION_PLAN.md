# Furqan Modernization Plan — Staged Execution

> Source: synthesized from the `website-skill` NotebookLM (modern Next.js / React / a11y / perf book corpus) and mapped onto Furqan's actual stack (Next.js 16.2.2 App Router, React 19, Supabase, Tailwind 4, next-intl RTL/LTR, Daily.co, n8n).
>
> Designed for non-stop auto-mode execution: each stage is **independently shippable**, has a clear scope, file list, and verification step. Run them in order; do not skip the verification before moving to the next stage.

## Global pre-flight (run once before Stage 1)

- [ ] `git status` clean; create branch `chore/modernize-2026-04`
- [ ] `node -v` matches `.nvmrc` (24.x)
- [ ] `npx next build` baseline passes
- [ ] `npm run lint` baseline passes
- [ ] Run `gitnexus_detect_changes()` — record baseline; rerun at end of every stage
- [ ] `git config user.email "drdeebtech@gmail.com"` (per CLAUDE.md git-author rule)

---

## Stage 1 — Streaming + loading skeletons

**Why**: Audit cut Supabase round-trips 5-7 → 2-3; streaming makes the remaining 2-3 perceptually free.

**Scope**: Add `loading.tsx` + `<Suspense>` boundaries to the slowest dashboards.

**Files to add**:
- `src/app/admin/control-tower/loading.tsx`
- `src/app/admin/control-tower/page.tsx` — split into shell + `<Suspense>`-wrapped widgets
- `src/app/student/teachers/loading.tsx`
- `src/app/student/dashboard/loading.tsx`
- `src/app/teacher/dashboard/loading.tsx`
- `src/app/teacher/students/loading.tsx`
- `src/app/admin/users/loading.tsx`
- `src/app/admin/teachers/loading.tsx`

**Pattern**: skeleton matches the real layout (same heights, no layout shift). Reuse Liquid Glass tokens from `.impeccable.md`.

**Acceptance**:
- Each route renders a skeleton in <100ms regardless of DB latency.
- No `layout shift > 0.05` (verify in browser DevTools → Performance).
- `gitnexus_detect_changes()` shows changes scoped to these files only.

**Verification**: `npx next build` passes; manual click-through with throttled 3G in DevTools — skeletons appear, then content streams in.

---

## Stage 2 — `next/image` + `next/font`

**Why**: Raw `<img>` tags cost CLS + bandwidth; Google Fonts trip CSP; Arabic typefaces need stable metrics for RTL.

**Scope**: Replace all `<img>` with `<Image>`; self-host fonts via `next/font/local`.

**Files to audit/edit**:
- `src/components/public/*` — testimonials, register-banner, public-nav avatars
- `src/components/shared/*` — any avatar / hero images
- `src/app/teacher/[id]/page.tsx`, `src/app/student/teachers/page.tsx` — teacher photo cards
- `src/app/(public)/blog/[slug]/page.tsx` — blog covers
- `src/app/layout.tsx` (or per-locale layout) — load font via `next/font/local`

**Concrete steps**:
1. `grep -rn "<img " src/` — list every raw img.
2. Replace each with `next/image`, supply explicit `width`/`height` or `fill` + sized parent.
3. Download Arabic + Latin fonts (likely IBM Plex Sans Arabic + Inter), drop into `src/app/fonts/`.
4. Configure `next/font/local` with `display: swap`, expose `--font-arabic` + `--font-latin` CSS vars.
5. Remove any `<link rel="preconnect" href="fonts.googleapis.com">` from `<head>`.
6. Update CSP in `vercel.json` — remove `fonts.googleapis.com` from `font-src` allowlist if present.

**Acceptance**: `grep -rn "<img " src/` returns zero hits in components (allowed only in OG routes / email templates). Lighthouse Best Practices ≥ 95 on `/teachers`.

**Verification**: Lighthouse audit on `/`, `/teachers`, `/blog/[any-slug]`. CLS < 0.05.

---

## Stage 3 — Cache revalidation discipline (`revalidateTag` + Next 16 Cache Components)

**Why**: Highest-ROI single upgrade. Many small writes (booking flips, homework grading) currently nuke whole route segments. Tag-based invalidation = 5-10x faster perceived dashboard updates.

**Scope**: Migrate from `revalidatePath` to `revalidateTag` everywhere mutations happen; adopt Cache Components per the Vercel knowledge update.

**Files to edit**:
- `src/lib/actions/homework.ts` — tag `homework:${studentId}`, `homework:teacher:${teacherId}`
- `src/lib/actions/evaluations.ts` — tag `evaluations:${studentId}`
- `src/lib/actions/notifications.ts` — tag `notifications:${userId}`
- Any server action that mutates: bookings, sessions, packages, services, blog
- Read sites: every `await supabase.from(X).select()` in a Server Component → wrap in `unstable_cache` (or new `'use cache'` directive per Next 16) keyed by tags above.

**Tag taxonomy** (define once, document):
```
bookings:user:${userId}
bookings:teacher:${teacherId}
sessions:user:${userId}
sessions:teacher:${teacherId}
homework:student:${studentId}
homework:teacher:${teacherId}
notifications:${userId}
evaluations:student:${studentId}
control-tower         # admin global
n8n-workflows         # admin /admin/n8n
```

**Acceptance**:
- Every server action calls `revalidateTag(...)` instead of (or in addition to) `revalidatePath(...)`.
- Read paths use Next 16's `'use cache'` + `cacheTag(...)` (per the vercel-plugin knowledge update at session start).
- `EVENT_CATALOG.md` updated with the tag taxonomy.

**Verification**: simulate a homework grading action — only the affected student's dashboard widgets re-fetch, not the whole `/student/[id]` segment. Verify with React DevTools Profiler.

**Risk**: HIGH per gitnexus impact analysis. Before edit, run `gitnexus_impact({target: "revalidatePath", direction: "upstream"})`.

---

## Stage 4 — `error.tsx` + `not-found.tsx` per role segment

**Why**: Routes-level error UI complements existing `loudAction` + `<ActionFeedback>`. Different audiences need different fallback UI (Arabic copy, role-aware nav).

**Scope**: Add error + not-found per top-level segment.

**Files to add**:
- `src/app/admin/error.tsx`, `src/app/admin/not-found.tsx`
- `src/app/teacher/error.tsx`, `src/app/teacher/not-found.tsx`
- `src/app/student/error.tsx`, `src/app/student/not-found.tsx`
- `src/app/moderator/error.tsx`, `src/app/moderator/not-found.tsx`
- `src/app/(public)/error.tsx`, `src/app/(public)/not-found.tsx` (likely already exist — verify)
- Top-level `src/app/error.tsx`, `src/app/not-found.tsx` (verify; create if missing)

**Pattern**:
- Each `error.tsx` is `"use client"`, takes `{ error, reset }`, calls `Sentry.captureException(error)` (Sentry SDK is scaffolded — see CLAUDE.md), shows Arabic-first message, role-appropriate action ("Back to dashboard" / "Try again" / "Contact admin").
- Each `not-found.tsx` shows Arabic 404 with a return-to-dashboard CTA scoped to the role.

**Acceptance**: throw an intentional error in any role action — segment-level `error.tsx` renders, Sentry receives the event, user sees Arabic fallback.

**Verification**: in dev, add `throw new Error("test")` to one server component per segment, click the route, confirm scoped fallback. Remove the throws.

---

## Stage 5 — `zod` validation inside `loudAction`

**Why**: Most `loudAction` handlers throw on Supabase errors but don't validate input shape. zod gives typed schemas, better user messages, defense in depth.

**Scope**: Add a `schema` option to `loudAction` and migrate top-traffic handlers.

**Files to edit**:
- `src/lib/actions/loud.ts` — extend `loudAction` config with optional `schema: z.ZodType<I>`; parse FormData/object before calling `handler`.
- Top 10 most-called server actions (use `gitnexus_query({query: "use server"})` to rank by callers): bookings, homework grading, evaluations, profile updates, package selection.
- `package.json` — confirm `zod` already installed (likely yes via Supabase types); if not, `npm i zod`.

**Pattern** (in `loud.ts`):
```ts
loudAction({
  name: "...",
  schema: z.object({ teacherId: z.string().uuid(), notes: z.string().min(1).max(2000) }),
  handler: async ({ teacherId, notes }) => { ... }
})
```
Validation failure → `{ ok: false, error: "..." }` rendered by `<ActionFeedback>`. No Telegram alert (validation errors are user-input, not system failures).

**Acceptance**: Top 10 handlers have schemas; passing malformed FormData (test via curl or browser DevTools) returns a friendly Arabic error, not a 500.

**Verification**: write 1 test per migrated handler that submits invalid input and asserts `ok: false`.

---

## Stage 6 — Search + pagination via URL params

**Why**: `/admin/users`, `/admin/teachers`, `/student/teachers`, `/admin/bookings` all need filter UI. URL-param pattern is shareable, server-rendered, no client state.

**Scope**: Add searchParams-driven filter/search/pagination to listing pages.

**Files to edit**:
- `src/app/admin/users/page.tsx`
- `src/app/admin/teachers/page.tsx`
- `src/app/admin/bookings/page.tsx`
- `src/app/student/teachers/page.tsx`
- `src/app/teacher/students/page.tsx`
- `src/components/shared/data-table.tsx` — accept `searchParams` + helper for `?q=&page=` pattern.
- New: `src/components/shared/search-input.tsx` — debounced client input that calls `useRouter().replace`.

**Acceptance**: each listing page works with `?q=ahmad&page=2&filter=archived` directly in the URL; results are server-rendered; back/forward buttons work; sharing the URL reproduces the view.

**Verification**: paste a filtered URL in a fresh tab — same results render server-side without client JS.

---

## Stage 7 — Metadata API for SEO + sharing

**Why**: Public surfaces drive registrations. Need OG images, descriptions, canonical URLs, bilingual `alternates.languages`.

**Scope**: Add `generateMetadata` + OG to every public route.

**Files to edit**:
- `src/app/(public)/layout.tsx` — site-wide defaults.
- `src/app/(public)/teachers/[id]/page.tsx` — per-teacher OG (photo, bio snippet, Arabic + English titles).
- `src/app/(public)/blog/[slug]/page.tsx` — per-post (already partially exists per Open Questions note in Run Log; finalize).
- `src/app/(public)/packages/[id]/page.tsx`, `services/[id]`, `about`, `contact`.
- `src/app/(public)/teachers/[id]/opengraph-image.tsx` — dynamic OG image route per the existing pattern.

**Acceptance**: every public page returns valid OG tags; `alternates.languages = { ar: ..., en: ..., 'x-default': ... }` set; Twitter card shows correct preview.

**Verification**: paste a teacher page URL into the [Twitter Card Validator](https://cards-dev.twitter.com/validator) and Facebook's Sharing Debugger — both show OG image + correct title.

---

## Stage 8 — Accessibility (Arabic + RTL specific)

**Why**: Furqan serves all ages including children + hāfiz. Arabic screen readers do not infer, so explicit a11y matters more than in LTR-only apps.

**Scope**: Audit + fix RTL/Arabic-specific a11y gaps.

**Tasks**:
1. **Color contrast** — audit Liquid Glass tokens against Arabic text on glass surfaces (Arabic fonts often render thinner; raise body text ≥ 4.5:1).
2. **Form labels** — every `<input>` has explicit `<label htmlFor>`; no placeholder-as-label.
3. **`lang` + `dir` per heading block** — when mixing Arabic + English in a heading or callout, wrap each in `<span lang="..." dir="...">`.
4. **`aria-live`** — `<ActionFeedback>` gets `aria-live="polite"` so success/error banners are announced.
5. **Keyboard navigation** — `tabIndex` audit on custom dropdowns (notification bell, lang-toggle, theme-toggle).
6. **Focus rings** — never remove without replacing; check `outline: none` usage.

**Files**:
- `src/components/shared/action-feedback.tsx`
- `src/components/shared/notification-bell.tsx`
- `src/components/shared/topbar.tsx`, `nav.tsx`
- `src/lib/i18n/lang-toggle.tsx`, `src/lib/theme/theme-toggle.tsx`
- All form components — grep for `<input ` without `<label`.

**Acceptance**: Lighthouse Accessibility ≥ 95 on `/`, `/login`, `/student/dashboard`, `/teacher/dashboard`. axe-core reports zero serious/critical violations.

**Verification**: keyboard-only navigation through entire student flow (login → book session → join Daily room) succeeds; Arabic screen reader (VoiceOver in Arabic locale) announces every interactive element.

---

## Stage 9 — Final pass + ship

- [ ] `npx next build` clean
- [ ] `npm run lint` clean
- [ ] `npx playwright test` clean
- [ ] `gitnexus_detect_changes()` — affected scope matches the staged plan
- [ ] Update `ROADMAP.md` — mark these 8 stages as SHIPPED with dates
- [ ] Update `AUDIT.md` — re-grade affected sections
- [ ] Run `mcp__claude_ai_Supabase__get_advisors({type: "security"})` — verify nothing regressed
- [ ] `git push`; `npx vercel ls furqan --prod` confirms deploy succeeded
- [ ] Save run notes to Obsidian via `/vault-save`

---

## Stage gates (auto-mode safety rules)

Auto mode must **stop and confirm** before:
- Stage 3 (cache revalidation — HIGH risk per gitnexus)
- Removing any environment variable or modifying `vercel.json` security headers
- Schema changes (none planned in this plan, but if one appears, halt)
- Force-push or branch deletion
- Anything that would touch production Supabase data outside RLS

For everything else (file creation, type-safe edits, lint/build runs), proceed without prompting.
