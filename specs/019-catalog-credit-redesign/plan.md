# Implementation Plan: Product Catalog + Credit/Package Redesign

**Branch**: `019-catalog-credit-redesign` | **Date**: 2026-06-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/019-catalog-credit-redesign/spec.md`

---

## Summary

Build the hifz product catalog (6 tiers: 3 group + 3 individual hour bundles), single-active-hifz DB enforcement, monthly credit grant sizing into `student_packages`, guardian/child accounts with configurable family discounts, and constrained mid-month tier upgrades with Stripe proration. Layered on spec 018's billing rails — extends `subscription_plans` and `subscriptions`; adds 3 new tables. All prices/discounts are admin-editable data in `platform_settings`, never hardcoded.

---

## Technical Context

**Language/Version**: TypeScript 5 strict, Node 24, Next.js App Router  
**Primary Dependencies**: Supabase JS v2, Stripe Node SDK (spec 018), Zod v3  
**Storage**: PostgreSQL 15 via Supabase; migrations in `supabase/migrations/` after baseline  
**Testing**: Vitest (unit), Playwright (E2E critical flows)  
**Target Platform**: Vercel serverless — all financial ops server-only  
**Constraints**: RLS every new table; service-role-only financial writes; `userId` from session; `(select auth.uid())` initplan on all policies; no hardcoded prices  
**Scale/Scope**: ~hundreds of students; catalog <20 rows (mostly static)

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| RLS on every new table, policies in same migration | ✅ PASS | |
| Service-role key server-only | ✅ PASS | |
| `userId` from auth session, never request input | ✅ PASS | |
| Zod validation at every route handler | ✅ PASS | |
| Financial columns guarded by BEFORE UPDATE OF | ✅ PASS | `price_usd`, `sessions_per_month`, `discount_pct` |
| SECURITY DEFINER EXECUTE lockdown | ✅ PASS | Grant function revokes from public/anon/authenticated |
| `npm run db:types` + tsc + lint pass | ✅ GATE | Required before PR merge |
| Local Postgres verification of grant logic | ✅ GATE | NFR-004: simulate multi-cycle + single-active-hifz race |
| Additive credit merge (never overwrite) | ✅ PASS | New `student_packages` row per cycle |
| No hardcoded prices | ✅ PASS | All from `platform_settings` or catalog rows |

---

## Project Structure

### Source Code Layout

```text
src/
├── app/api/
│   ├── catalog/hifz/route.ts              ← GET active tiers
│   ├── subscriptions/
│   │   ├── upgrade-tier/route.ts          ← POST immediate same-type upgrade
│   │   └── schedule-tier-change/route.ts  ← POST deferred change
│   └── guardian/
│       ├── children/route.ts              ← GET list children
│       └── add-child/route.ts             ← POST link child
└── lib/domains/catalog/
    ├── tiers.ts                           ← query/seed catalog
    ├── discounts.ts                       ← apply/audit family discounts
    └── tier-changes.ts                    ← upgrade + schedule logic

supabase/migrations/
├── 20260617000000_catalog_credit_redesign.sql
│   — extends subscription_plans (is_hifz_product, sessions_per_month, session_duration_min)
│   — extends subscriptions (is_hifz boolean for partial unique index)
│   — partial unique index: subscriptions(student_id) WHERE is_hifz AND status IN (active,past_due,incomplete)
│   — guardian_children, subscription_discount_records, pending_tier_changes + RLS
│   — seeds 6 tiers into subscription_plans; seeds platform_settings keys
│   — BEFORE UPDATE OF guards on financial columns
└── 20260617000001_catalog_grant_function.sql
    — grant_hifz_cycle_credits(subscription_id, plan_id): inserts student_packages row
    — SECURITY DEFINER; revoke from public/anon/authenticated; grant to service_role
```

---

## Key Implementation Decisions

1. **Single-active-hifz**: Partial unique index on `subscriptions(student_id)` WHERE `is_hifz = true AND status IN ('active','past_due','incomplete')`. `is_hifz` denormalized from `subscription_plans.is_hifz_product` at create time.

2. **Catalog model**: Extend `subscription_plans` (spec 018) with `is_hifz_product`, `sessions_per_month`, `session_duration_min`. Each of the 6 tiers = one `subscription_plans` row. Existing `packages` table unchanged (remains for one-time products and legacy).

3. **Additive credit merge**: Each paid cycle inserts a NEW `student_packages` row via `grant_hifz_cycle_credits`. Never mutates prior rows. `sessions_remaining` (GENERATED) sums correctly per row.

4. **Stripe mid-month proration**: `stripe.subscriptions.update` with `proration_behavior: 'always_invoice'`. Delta credits = `new_sessions_per_month - old_sessions_per_month` prorated by remaining seconds in cycle. Granted immediately for UX; idempotent on webhook retry via `billing_events` unique constraint (spec 018).

5. **Guardian discount**: At child B checkout, check `guardian_children` for guardian's existing active individual subscriptions. If ≥1 exists, apply `platform_settings.hifz_second_subscription_discount_pct`. Record in `subscription_discount_records`.

6. **Pending-change application at renewal (FR-019)**: the Stripe `invoice.paid` webhook branch is the owner — after the normal cycle grant it transitions the subscription's single pending `pending_tier_changes` row `pending → applied` (sets `applied_at`), switches the subscription to the new tier, and re-grants credits at the new tier's `sessions_per_month`. The single-pending invariant is enforced by a partial UNIQUE index on `pending_tier_changes(subscription_id) WHERE status='pending'`. (Task T014a — no longer deferred.)

7. **platform_settings keys seeded**: `hifz_individual_hourly_rate_usd=10.00`, group tier prices, discount pcts start at 0 (admin sets real values).

---

## Artifacts

| File | Status |
|------|--------|
| research.md | ✅ Complete |
| data-model.md | ✅ Complete |
| contracts/api.md | ✅ Complete |
| quickstart.md | ✅ Complete |
| tasks.md | ⏳ Next — run `/speckit-tasks` |
