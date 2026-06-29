# Spec 034 — Admin analytics dashboard + audit-log viewer

**Source issue:** #555
**Status:** ✅ implemented (reduced scope — 2026-06-29). D1–D4 resolved below.
**Author lens check:** 🛠 engineer · 🎓 platform expert (no Quran-text surface here, 📖 lens N/A)

> **Scope reduction (verified against code):** most of #555 already existed —
> revenue on `/admin/dashboard` + `/admin/payments`, churn on `/admin/retention`,
> an audit-log viewer on `/admin/audit`. Building duplicates was rejected. Only
> the genuine gaps were built:
> - **NEW `/admin/analytics`** — active-user counts (DAU/WAU/MAU, students+teachers)
>   + cross-teacher completion rate; links out to existing revenue + churn.
>   Queries in `src/lib/views/admin-analytics.ts` (+ unit tests).
> - **Extended `/admin/audit`** — actor (clickable user), `table_name`, and
>   from/to date filters + CSV export (`/admin/audit/export` route, `requireAdminForApi`-gated).
>   Shared filter parsing in `src/lib/admin/audit-filters.ts`.
>
> **D1 → proxy** (no `last_active_at`): activity from started `sessions` joined to `bookings`.
> **D2 → ship now**: audit filters by table+op+actor+date; no `action_name` column.
> **D3 → tracks/tiers** noted, but revenue itself reused from existing dashboard (not rebuilt).
> **D4 → moot**: revenue not rebuilt here (already on `/admin/dashboard`).

---

## 1 · Goal

Give admins two read-only operational surfaces:

- **`/admin/analytics`** — platform health: activity, session completion, revenue.
- **`/admin/audit-log`** — a filterable, exportable view of the existing `audit_log` table.

Both gated by `requireAdmin()` (`src/lib/auth/require-admin.ts:110`). Server-rendered, consistent with the other `src/app/admin/**` pages.

---

## 2 · Reality check — where the issue's assumptions are wrong

The issue says "read-only queries over existing tables — **no new schema required**." Verified against the code, that is only partly true. Three corrections drive the open decisions below:

### 2.1 · `last_active_at` does not exist
The issue proposes "DAU/MAU" and "churn signals from `last_active_at`". **There is no `last_active_at` column** anywhere in `src/lib/supabase/schema.sql` or `supabase/migrations/`. So either:
- **(A)** derive activity from a **proxy** — e.g. `sessions.created_at` / `student_progress.created_at` (in-app activity), or `auth.users.last_sign_in_at` (login activity) — keeping the "no new schema" promise; **or**
- **(B)** add a `profiles.last_active_at` column + a cheap touch-on-request update — more accurate, but new schema + a write on the hot path.

→ **Open decision D1.**

### 2.2 · `audit_log` is a row-change log, not a named-action log
Actual columns (`schema.sql:537`):
`id, changed_by, table_name, record_id, action ∈ {INSERT,UPDATE,DELETE}, old_data, new_data, reason, ip_address, created_at`.

`loudAction()` → `writeAudit()` (`src/lib/actions/loud.ts`) **does** write rows here, but the human-readable action name (`config.name`, e.g. `booking.confirm`) is **not stored** — it only goes to Sentry tags. So the issue's "filter by **action type**" can only mean **`table_name` + `action` (INSERT/UPDATE/DELETE)**, plus **actor (`changed_by`)** and **date range**. Filtering by *named business action* would require a new `audit_log.action_name` column + backfill.

→ **Open decision D2** (ship with table+op filters now, or add `action_name` first).

### 2.3 · The reports domain has no analytics functions yet
`src/lib/domains/reports/` contains only `monthly-report.ts` (per-student monthly report), `month-close-detector.ts`, and `notes.ts`. **None** of DAU/MAU, completion-rate, revenue-by-cohort, or churn exist. The domain is a sensible *home* for them, but they are **new query functions**, not reuse. "Over existing reports domain" overstates it.

---

## 3 · Scope

### 3.1 · `/admin/analytics` (new page)
New read-only query functions under `src/lib/domains/reports/analytics.ts` (server-only), surfaced by a server component:

| Metric | Source (proxy, pending D1) | Notes |
|---|---|---|
| Active students/teachers (DAU/WAU/MAU) | distinct actor on `sessions` / `student_progress` in window, or `auth last_sign_in_at` | D1 picks the source |
| Session completion rate by teacher | `sessions` status counts grouped by `teacher_id` | completed ÷ scheduled |
| Revenue | Stripe-synced billing tables (verify which: `subscriptions` / invoices). **Revenue "by cohort"** needs a cohort definition — **D3** | MRR + new/churned this period |
| Churn signals | inactivity window from the D1 source; `subscriptions` in `past_due`/`canceled` | list + count |

All numbers are aggregates; no PII beyond names already visible to admins. Each query fail-closed and tagged via `logError({ route: "/admin/analytics", widget })` per the project's widget-tagging convention.

### 3.2 · `/admin/audit-log` (new page)
Server-rendered table over `audit_log`, newest first (uses `idx_audit_created`):
- **Filters:** actor (`changed_by`), `table_name`, `action` (INSERT/UPDATE/DELETE), date range.
- **Pagination:** keyset on `(created_at, id)` — **not** `OFFSET` (unbounded table). Page size 50.
- **CSV export:** current filter set, capped (e.g. 10k rows) with an explicit "truncated at N" notice — never a silent cap (lesson: PostgREST truncation).
- `old_data`/`new_data` shown as collapsed JSON; redaction already handled upstream (`v15_002_audit_pii_redaction.sql`) — verify it covers what this UI surfaces.

---

## 4 · Out of scope
- No new event-tracking pipeline (DAU via proxy unless D1 = B).
- No charts library mandate — start with server-rendered tables + simple bars; richer viz is a follow-up.
- No write/mutation actions on either page.

---

## 5 · Security (🛠 lens)
- Both pages: `requireAdmin()` server-side, before any query. No client-gated access.
- Audit-log rows can contain `ip_address` + `old/new_data` — confirm admin-only RLS on `audit_log` and that the CSV path runs server-side under the same guard.
- CSV export is a state-reading endpoint over potentially large/sensitive data — rate-limit and cap rows.
- Service-role usage stays server-only; no `NEXT_PUBLIC_*` leakage of metrics queries.

---

## 6 · Open decisions (need owner/architect answer before tasks)
- **D1 — activity source:** proxy (no schema) vs add `profiles.last_active_at` (accuracy). *Recommend: proxy from `sessions`/`student_progress` for v1; revisit if it's too coarse.*
- **D2 — audit filters:** ship table_name+action+actor+date now (no schema) vs add `audit_log.action_name` first. *Recommend: ship now; add `action_name` later only if admins ask to filter by business action.*
- **D3 — "revenue by cohort":** define cohort (signup month? plan tier? track?). *Recommend: by plan tier + by signup month, both cheap from billing tables.*
- **D4 — verify billing source tables** for revenue (which table holds active-subscription + amount) before writing the revenue query.

---

## 7 · Acceptance criteria (revised from issue)
- [ ] `/admin/analytics` renders activity (per D1), completion-by-teacher, revenue (per D3) — fail-closed widgets, no crash on empty data.
- [ ] `/admin/audit-log` table with actor / table_name / action / date filters, keyset pagination.
- [ ] CSV export with explicit truncation notice when capped.
- [ ] Both pages `requireAdmin()`-gated; verified unauthenticated + non-admin both bounce.
- [ ] No new DB tables **if D1=proxy and D2=now**; any schema add ships its RLS in the same migration.
- [ ] `npm run test:unit` + `npm run build` pass; new query fns unit-tested with seeded data.

---

## 8 · Next steps
1. Owner/architect resolves D1–D4.
2. Write `plan.md` (data-model deltas if any, query contracts) → `tasks.md`.
3. Implement (this agent, per current directive — no delegation).
