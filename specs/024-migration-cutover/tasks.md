# Tasks: Migration Cutover (Spec 024) — RE-SCOPED

**Input**: `specs/024-migration-cutover/` (spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md)
**Branch**: `024-migration-cutover`
**Re-scoped**: 2026-06-20

---

## ⚠️ Re-scope notice — the data-migration half is MOOT

User confirmed on **2026-06-20** that production holds **only test/seed data** — there are
**no real students with hifz progress, no real balances/credits, no real in-flight bookings** to
migrate. This collapses the entire data-migration half of spec 024.

**DROPPED (no real data to move):** US1 (hifz superset-merge), US2 (user→tier mapping),
US3 (balance→entitlement conversion), US5 (in-flight bookings) — and all the rehearsal /
reconciliation tooling (`migration_runs`/`migration_entity_markers`/`manual_review_bucket` ops
tables, `ledger.ts`, mapping scripts, reconciliation report generators, admin migration routes,
rollback route, production-copy rehearsal). The original 40-task list is preserved in git history
(see the commit prior to this re-scope) for audit.

**The 4 human-gated open items are also moot** for the same reason: cutover DATE/TIME,
balance-conversion policy, rollback authority, and captured-live-payments policy all only mattered
because real data/charges were in play.

**Verdict basis:** specs 018–023 all shipped live; the 6 target tables verified present in prod via
regenerated types. Prereqs were GREEN — only the *data* was absent.

---

## What actually remains (data-independent)

Three items survive. Two are **operational** (need prod credentials — operator-run, not
code-build); one is a **code change**.

| # | Item | Type | Owner |
|---|------|------|-------|
| A | Prod `schema_migrations` reconciliation (the real clean-deploy blocker) | Ops | Operator (prod creds) |
| B | Retire legacy booking / package / credits code paths | **Code** | Claude (this branch) |
| C | Stripe test→live flip (keys/config only, 0 code) | Ops | Operator (prod creds) |

---

## Phase A — Prod schema-history reconciliation (OPS — operator-run)

> Operational, against production credentials. Documented here; **not executed by an agent from
> this session.** NEVER `db push` the baseline `20260428000000_remote_baseline.sql`.
> See memory `project_db_password_rotation_deferred`, `project_supabase_migration_topology`.

- [ ] A1 Derive the actual pre-baseline version set at run time from prod `schema_migrations`
  (the documented "~103" is an approximation — query the real versions, do not hardcode a count).
- [ ] A2 For each pre-baseline version: `supabase migration repair --status reverted <version>`.
- [ ] A3 Apply post-baseline migrations (`supabase db push` of the post-baseline timestamped
  migrations only — the baseline is already the remote HEAD and is never pushed). On any failure:
  halt and abort; never force-push.
- [ ] A4 Confirm a clean deploy: `supabase migration list` shows local == remote with 0 baseline
  force-pushes.

---

## Phase B — Retire legacy code paths (CODE — this branch)

> The pivot replaced per-session booking / package purchase / credits with monthly subscriptions +
> courses. Remove the dead legacy customer + admin surface. **Lowest-risk slice first: make legacy
> unreachable (remove customer-facing pages + nav links) before touching any shared billing/webhook
> layer.** Confirm the full import graph before deleting anything; `tsc --noEmit` + `lint` +
> `test:unit` green per step. Do NOT remove shared files the new system uses
> (`api/stripe/webhook/route.ts`, `domains/billing/orchestrate.ts`, `stripe/fulfillment.ts`,
> `dashboard-queries.ts`, `views/student-dashboard.ts`, `reconciliation.ts`).

- [X] B1 **Map the legacy import graph** (DONE — read-only exploration 2026-06-20). Result:
  - **SAFE TO REMOVE (UI/purchase surface):** `src/app/student/packages/`,
    `src/app/(public)/packages/` (page + `paypal-actions.ts` + `currency-packages.tsx` +
    `packages-content.tsx`), `src/components/shared/paypal-buy-button.tsx` (only imported by
    `currency-packages.tsx`), `src/app/admin/packages/` (whole dir), `src/app/admin/credits/`
    (whole dir).
  - **COUPLED — do NOT remove (shared/active):** `src/lib/domains/package/ledger.ts` —
    `selectActivePackage`/`debitPackage` are called by ACTIVE code (`booking/actions.ts`,
    `actions/class-offerings.ts`, `actions/group-session.ts`) to debit `student_packages`, which the
    NEW subscription system grants into. This is the shared deduction layer, not legacy. A
    subscription-aware rename/refactor is a **separate** task, OUT OF SCOPE here.
  - **NOT LEGACY — leave entirely:** `src/lib/domains/catalog/credit-grant.ts` — NEW Spec-018
    subscription code (Stripe webhook `applyPendingTierChangeAtRenewal` + `subscriptions/upgrade-tier`
    `grantHifzCycleCredits`). Earlier memory mis-listed it as a candidate; corrected here.
- [X] B2 **Remove customer-facing purchase pages + PayPal + nav links** (lowest risk — makes legacy
  unreachable): delete `src/app/student/packages/`, `src/app/(public)/packages/`,
  `src/components/shared/paypal-buy-button.tsx`; remove every nav/href/SEO ref to `/student/packages`
  and `/packages` (`nav.tsx`, `public-nav.tsx`, `public-footer.tsx`, `register-banner.tsx`,
  `home-content.tsx`, `dashboard-content.tsx`, `settings/page.tsx`, `dashboard-queries.ts`,
  `sitemap.ts`, `robots.ts`, `cache.ts`). Typecheck + lint + test.
- [X] B3 **Remove admin legacy surface**: `src/app/admin/packages/`, `src/app/admin/credits/` +
  their nav links (`nav.tsx`, `control-tower-grid.tsx`). Typecheck + lint + test.
- [ ] ~~B4 Remove legacy domain files~~ **CANCELLED** — B1 shows `package/ledger.ts` is shared-active
  and `catalog/credit-grant.ts` is new-system code. Neither is removable here. The deeper
  subscription-aware deduction refactor of `ledger.ts` is tracked separately, not part of 024.
- [X] B5 Full green gate (2026-06-20): `npx tsc --noEmit` PASS, `npm run lint` 0 errors,
  `npm run test:unit` 776 passed / 24 skipped / 0 failed; dangling-reference sweep clean.
  **Softened (no live billing page yet — repoint when one exists):** student dashboard "Active
  Package" StatCard `href` → `/student/sessions` + dropped "Buy Package" CTA; calendar
  `package_expiry` event `href` → `/student/dashboard`. **Left as separate follow-up:** dormant CMS
  slot `home_package_preview` (admin content editor + `SiteFeature` slot union) — renders nowhere now
  but still editable; remove in a content-model cleanup. NOT committed yet.

---

## Phase C — Stripe test→live flip (OPS — operator-run)

> Keys/config only, **zero code** (FR-019, env-driven — no `if (test)` branch). Operator action.

- [ ] C1 Set live `STRIPE_SECRET_KEY` (`sk_live_…`) + live `STRIPE_WEBHOOK_SECRET` in the Vercel
  project env; remove/replace test keys.
- [ ] C2 Point the Stripe live webhook endpoint at the prod `/api/stripe/webhook` URL; verify
  signature with the live signing secret.
- [ ] C3 Smoke-test one live checkout end-to-end; confirm webhook fulfillment fires.

---

## Dependencies / order

- **Phase B** (legacy retirement) is the only agent-executable work here and can proceed now on this
  branch, independent of A and C.
- **Phase A** (schema reconcile) is the prod clean-deploy blocker — operator-run before/at deploy.
- **Phase C** (Stripe flip) is operator-run at cutover, after the app deploy is verified.

## DROPPED tasks (audit trail)

Original T001a, T001–T040 (data-migration machinery: ops tables, ledger, user-to-tier,
balance-to-entitlement, progress-merge, reconciliation generators, admin migration/reconciliation/
manual-review/rollback routes, run-migration orchestrator, in-flight booking resolution,
production-copy rehearsal) are **DROPPED** — no real data to migrate (see re-scope notice).
Recover from git history if production data assumptions ever change.
