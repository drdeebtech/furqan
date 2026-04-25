# Frontend Audit — Senior Review · 2026-04-25

Frontend-only audit covering RSC boundaries, state management, performance, rendering strategy, design-system consistency, RTL/i18n, and motion. Three parallel exploration agents ran across disjoint lenses; this document consolidates real findings after triaging false positives.

## Methodology + false-positive notes

- **Lens A** — RSC + component architecture + state management
- **Lens B** — performance + rendering + bundle/loading
- **Lens C** — design system consistency + RTL/i18n + motion

**False positives caught and dropped:**
- `text-left` on `dir="ltr"`-forced English fields (slug, English titles, time inputs). Already analyzed this earlier in the session — they're intentionally LTR and `text-left` is functionally identical to `text-start` there. Mass-replacing for "consistency" is hygiene, not a defect.
- `session-timer.tsx` 1s tick — a countdown display **requires** 1s granularity. Not a defect.
- `useActionState bound to teacherId` "fragile pattern" — `.bind(null, id)` is the canonical Server Action pattern from React docs.
- `agent C` claimed `transition-all` in "26+ files" — actual count is 12. Downgrading severity.

## Severity rubric (WCAG/perf-grade)

- **P0** — security/correctness defects on critical paths.
- **P1** — hydration mismatches, data-loss bugs, accessibility blockers.
- **P2** — perf wins ≥100ms, file-size bloat, UX inconsistency, missing reduced-motion.
- **P3** — micro-perf, naming drift, marginal cleanup.

## Findings

| # | Sev | Lens | File:Line | Finding | Suggested fix |
|---|-----|------|-----------|---------|---------------|
| 1 | P1 | RSC | `src/components/shared/pwa-install-prompt.tsx:16` | `useState(() => typeof window !== "undefined" ? !!sessionStorage.getItem(...) : false)` causes hydration mismatch — server renders `false`, client may render `true`. | Initialize to `false`; read sessionStorage in `useEffect`. |
| 2 | P1 | RSC | `src/components/shared/session-status.tsx:46` | `const now = Date.now()` directly in render. Server `now` ≠ client `now` → hydration drift on session "elapsed" badge. | Lift `Date.now()` into `useEffect` + `useState`; render `0` or `"—"` on first paint. |
| 3 | P1 | Perf | `src/app/admin/announcements/actions.ts:104,128,141,157` | 4× `revalidatePath("/")` invalidates the entire site cache on every announcement create/update/delete/deactivate. | Tag-based: `unstable_cache(..., ["site_announcements"])` on the read side; `revalidateTag("site_announcements")` here. |
| 4 | P1 | Design/RTL | `src/app/moderator/cv-review/[teacherId]/page.tsx:37`, `src/app/moderator/evaluations/new/page.tsx:31` | Hardcoded `<ArrowRight />` icon doesn't flip in RTL — points the wrong way for Arabic users on a "back" button. | Pattern from `stat-card.tsx`: `const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight`. |
| 5 | P1 | i18n | `src/app/admin/teachers/[id]/availability-editor.tsx:65,87,17` | Hardcoded Arabic strings ("تتعارض مع فترة موجودة", "الجدول الأسبوعي / Weekly slots", day names AR-only). Not bilingual. | Wrap in `t(ar, en)`; add `en` field to days array. |
| 6 | P1 | RSC | `src/app/admin/teachers/[id]/availability-editor.tsx:30-50` | `addSlot` action result not checked before clearing form — failed action silently loses user input. | `const r = await action(fd); if (r.error) { showError(r.error); return; } setForm(initial)`. |
| 7 | P2 | Perf | `src/components/shared/session-status.tsx:83` | `setInterval(check, 15_000)` polls for status changes — should be a Realtime subscription on `sessions`. | `supabase.channel("session-status").on("postgres_changes", {table:"sessions"}, check).subscribe()`. |
| 8 | P2 | Perf | `src/app/student/sessions/live-badge.tsx`, `src/app/admin/sessions/live/live-monitor.tsx`, `src/app/admin/n8n/components/n8n-tabs.tsx` | 3 more polling intervals (30s/10s) where Realtime would give instant updates with zero polling overhead. | Same pattern as #7. |
| 9 | P2 | Perf | `src/app/student/homework/page.tsx`, `src/app/student/packages/page.tsx`, `src/app/admin/packages/page.tsx`, `src/app/admin/automation/page.tsx`, `src/app/(public)/blog/[slug]/page.tsx`, `src/app/student/notifications/page.tsx`, `src/app/teacher/notifications/page.tsx` + 8 more | `select("*")` in 15+ places fetches columns the page doesn't render (metadata jsonb, internal flags, raw JSON blobs). | Narrow each to the columns actually consumed by JSX. |
| 10 | P2 | Perf | `src/app/admin/packages/page.tsx`, `src/app/admin/automation/page.tsx`, `src/app/api/n8n/admin-actions/route.ts` | Unbounded queries — no `.limit()` on tables that grow over time. | Add `.limit(100-200).order("created_at", desc)`. |
| 11 | P2 | RSC | `src/app/admin/teachers/[id]/availability-editor.tsx` (514 lines) | Component bloat — 8+ `useState`, 2 `useActionState`, overlap detection, edit modal all in one file. Hard to test, slow HMR. | Split into `AvailabilitySlotList`, `AddSlotForm`, `EditSlotModal`; move `detectOverlap` to a util. |
| 12 | P2 | RSC | `src/app/admin/n8n/components/overview-tab.tsx` (508 lines) | Same bloat — 9+ `useState`, mixed action patterns, search-filter on every keystroke. | Extract `WorkflowCard`, `ExecutionStats`, `SearchBar`; debounce search. |
| 13 | P2 | RSC | `src/app/admin/n8n/components/overview-tab.tsx:160` | `toggleWorkflowAction(wid)` called without `await` or result check — race condition on rapid toggling. | `const r = await toggleWorkflowAction(wid); if (!r.success) showError(r.error)`. |
| 14 | P2 | Design | repo-wide (12 files via grep) | `transition-all` is broad — animates every changed property including expensive ones (filter, backdrop-filter on glass cards). | Specific transitions: `transition-[opacity,transform,colors] duration-200`. |
| 15 | P2 | A11y/Motion | repo-wide | Zero `motion-safe:` / `motion-reduce:` variants — fails WCAG 2.1 SC 2.3.3 for users with vestibular disorders. | Wrap transitions: `motion-safe:transition motion-reduce:transition-none`. Apply to glass-card hover, animate-pulse uses. |
| 16 | P2 | RSC | `src/app/student/bookings/new/booking-form.tsx:200` | Teacher availability fetched on mount but not refetched when date selection changes — stale data if page is open overnight. | `useEffect(() => fetchAvailability(...), [teacherId, date])`. |
| 17 | P2 | RSC | `src/components/shared/messages-view.tsx:138` | Race condition on `openNewConvoDialog` — fetch result can update unmounted component if user closes mid-fetch. | `let mounted = true` cleanup pattern, or AbortController. |
| 18 | P2 | RSC | `src/app/student/bookings/new/booking-form.tsx:280` | Form submits even when availability fetch failed — possible booking against invalid data. | Guard: `if (!availability || availability.error) return`. |
| 19 | P2 | Design | repo-wide (33 instances across 16 files) | `text-left`/`text-right`/`ml-*`/`mr-*`/`pl-*`/`pr-*`/`left-*`/`right-*` hardcoded outside intentional `dir="ltr"` islands. Some are real RTL bugs, most are hygiene. | Audit per-file; convert to logical properties (`text-start`, `ms-*`, `me-*`, `start-*`, `end-*`). |
| 20 | P2 | i18n | repo-wide | `toLocaleDateString("en-US")` and `toLocaleString("en-US")` hardcoded in 15+ places where `lang` is in scope. | Centralize: `getLocale(lang)` helper in `src/lib/i18n/`. |
| 21 | P2 | Design | `src/app/admin/teachers/[id]/account-form.tsx:173` | Conditional class `ltr ? "text-left" : ""` — should always use logical class. | `text-start` unconditional. |
| 22 | P3 | Perf | `src/components/shared/notification-bell.tsx:40-43,74` | `loadNotifications` called twice on mount + `useState(() => Date.now())` freezes timestamp; "time ago" goes stale on long-open dropdowns. | Single mount fetch + `setInterval` updating `now` every 60s while dropdown open. |
| 23 | P3 | Perf | `src/app/student/packages/page.tsx:75-123` | Mapped package cards with inline `style={{ width: ... }}` re-create style objects every render. | Move to CSS variable: `style={{ "--w": pct + "%" } as CSSProperties}` + `.bar { width: var(--w) }`. |
| 24 | P3 | Design | `src/components/shared/data-table.tsx:106` | Avatar colors hardcoded as `bg-[#C7B9F0]` arbitrary classes. | Move to `--avatar-1..6` CSS vars; class set `.avatar-bg-1..6`. |
| 25 | P3 | Design | `src/app/opengraph-image.tsx`, `src/app/(public)/blog/[slug]/opengraph-image.tsx` | 8+ hardcoded brand hex codes duplicated between OG generators. | Extract to `src/lib/brand-colors.ts`. |
| 26 | P3 | RSC | `src/components/shared/messages-view.tsx:42-50` | 6+ independent `useState` calls for related UI state — risk of partial-update bugs. | Consolidate: `useReducer` or single `useState({ ui: {...}, form: {...} })`. |
| 27 | P3 | RSC | `src/app/admin/n8n/components/overview-tab.tsx:210` | Search input filters list on every keystroke (1000+ items possible). | Debounce 300ms via `useMemo` + small debounce util. |
| 28 | P3 | A11y | `src/components/shared/messages-view.tsx:320` | No `maxLength` on message input — paste-bombs degrade perf and may exceed server limits. | `maxLength={5000}` + visible counter. |
| 29 | P3 | Perf | `src/app/student/dashboard/page.tsx` (3 separate queries) | `next-booking`, `recent-sessions`, `recent-homework` are sequential where they could batch. | Single `Promise.all` (matches the wave-5 pattern from admin dashboard). |

## Triage summary

| Sev | Count | Disposition |
|-----|------:|-------------|
| P1 | 6 | Fix this pass — hydration drift, RTL arrows, lost-form-input, broad cache busting |
| P2 | 15 | Fix this pass for high-leverage items (#7, #8, #14, #15, #19); rest documented to ROADMAP |
| P3 | 8 | Defer to ROADMAP unless cheap |

## Wave plan (if executing)

1. **Wave 1 — Hydration fixes** (#1, #2): two surgical edits, eliminate the Date-of-render mismatches.
2. **Wave 2 — RTL arrows + i18n strings** (#4, #5, #21): `dir`-aware arrows, `t()` wraps for moderator + availability-editor.
3. **Wave 3 — Cache busting** (#3): replace `revalidatePath("/")` with `revalidateTag` on announcements; minor read-side rewrite.
4. **Wave 4 — Realtime conversion** (#7, #8): convert 4 polling intervals to Supabase Realtime. Biggest perf+UX gain in the audit.
5. **Wave 5 — Motion-safe** (#15): repo-wide `motion-safe:`/`motion-reduce:` sweep on `transition-*` classes.
6. **Wave 6 — Form-action result checks** (#6, #13, #18): a small audit of `await action(...)` callsites to ensure errors surface and form state stays consistent.
7. **Wave 7 — `select("*")` narrowing** (#9): 15+ files; mechanical but tedious.
8. **Defer:** component splitting (#11, #12), state consolidation (#26), and design-token extraction (#24, #25) — each deserves its own session.

## Out of scope

- Items already shipped this session (a11y on data-table, status-badge icons, admin form `htmlFor`, layout-level role check, etc.) — see commits `ec17f78` → `e8b9377`.
- Stripe / Anthropic / WhatsApp / Google Calendar — externally blocked.
