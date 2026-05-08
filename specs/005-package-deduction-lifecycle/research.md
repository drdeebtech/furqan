# Research: Package Deduction Lifecycle (دورة حياة الباقة)

**Branch**: `005-package-deduction-lifecycle` | **Date**: 2026-05-08

> Brownfield documentation. This file captures *already-made* decisions that produced the current shipped package implementation. It is a record, not a design exercise.

---

## Decision 1 — `deduct_package_session()` is plain SQL, not PL/pgSQL

**Choice**: The deduction function is declared as `LANGUAGE sql` with a single `UPDATE … RETURNING true` statement:

```sql
CREATE OR REPLACE FUNCTION deduct_package_session(p_package_id uuid)
RETURNS boolean
LANGUAGE sql
AS $$
  UPDATE student_packages
  SET sessions_used = sessions_used + 1
  WHERE id = p_package_id
    AND status = 'active'
    AND sessions_used < sessions_total
    AND (expires_at IS NULL OR expires_at > now())
  RETURNING true;
$$;
```

**Rationale**:
- Plain SQL functions can be inlined by the Postgres planner, are simpler to reason about, and the predicate-and-increment happens within a single row lock — no race condition is possible by Postgres semantics.
- A PL/pgSQL version would have introduced a separate function frame and potentially encouraged adding pre-checks (e.g., a SELECT before the UPDATE) which would have created a TOCTOU window.

**Alternative rejected**: PL/pgSQL with explicit lock (`SELECT ... FOR UPDATE`). Rejected because plain SQL is sufficient and the explicit lock pattern is more error-prone.

**Trade-off**: error messages are less informative — the function returns `null` when the predicate fails, which the caller must distinguish from "row not found" / "row not active" / "row exhausted" / "row expired". Today the caller treats them all as "deduction failed", which is acceptable.

---

## Decision 2 — State machine has 3 explicit values + 2 virtual states

**Choice**: `student_packages.status` CHECK constraint allows only `active | expired | cancelled`. The "exhausted" state from `LIFECYCLES.md` §4 prose is **virtual** — it's `active` with `sessions_used >= sessions_total`. The "purchased" state is similarly virtual — it's just the row's `DEFAULT 'active'` at insert time.

**Rationale (reconstructed)**:
- At V11 implementation time, the team designed the state machine around what's distinguishable in queries. "Exhausted" doesn't need a status flip because the bookable check already evaluates the predicate (sessions_used < sessions_total). Adding a status='exhausted' would require a write-on-deduction trigger, which is unnecessary churn.
- "Purchased" was never explicit because the system never observes a window between insert and active — packages are inserted as `active` immediately after PayPal capture.

**Drift recognised**: D-003 in spec.md (status='expired' never written by application). Reports filtering `WHERE status='expired'` undercount. **Edge case 1 in spec.md (virtual exhausted confuses callers) is the bigger issue** — admin dashboards reading `status` directly miss the exhausted students.

**Phase 2 candidate**: a query-time view `student_packages_v` that adds a computed `effective_status` column (one of `active | exhausted | expired | cancelled`) using `CASE` predicates. Reports use the view; mutations stay against the table.

**Trade-off**: simpler state machine at V11 vs. ongoing report-correctness friction.

---

## Decision 3 — Per-mode fallback is implicit (legacy `session_count` serves as `private` budget)

**Choice**: When `deduct_package_session_mode(p_package_id, p_mode)` is called and the per-mode counter `mode_counts->>p_mode` is 0, the function falls back to decrementing the legacy `session_count` (which is the `student_packages.sessions_total - sessions_used` budget — the "implicit private" pool).

The migration comment at `supabase/migrations/20260505211356_extend_packages_with_session_modes.sql:118` states:

> Per-mode session count: `{ "private": N, "halaqa": M, "lecture": K }`. Defaults to all-zero. Legacy packages with session_count > 0 implicitly grant `private` via the fallback in deduct_package_session_mode().

**Rationale**:
- Backward compatibility: every existing `student_packages` row at the time of the 2026-05-05 migration had `session_count > 0` and `mode_counts = '{}'`. Without fallback, all those rows would have been zeroed-out for halaqa/lecture booking, breaking ~5k active subscriptions.
- Forward-compat: new packages can specify `mode_counts` explicitly to *partition* the budget across modes. Old packages keep working under the fallback.

**Drift recognised**: D-004 in spec.md / edge case 4. A student whose package has `mode_counts = '{}' ` and `session_count = 8` enrolling in a halaqa silently consumes their private budget. They may not realise this until they try to book a private session and find 7 sessions remain.

**Phase 2 candidate**: explicit prompt — "Halaqa budget exhausted; deduct from private (1 of 8 remaining)?" Adds friction but removes surprise.

---

## Decision 4 — Time-based expiry is virtual (no cron flip)

**Choice**: When `expires_at < now()`, the package is functionally expired but `status` stays `'active'`. The deduction function's predicate catches this; n8n expiry-countdown workflow reads the predicate, not the status column.

**Rationale (reconstructed)**:
- Avoids a nightly cron that would touch ~10% of `student_packages` rows monthly at 50k DAU (rough expiry rate). At 3M total rows, this could be ~30k rows/month — non-trivial UPDATE volume.
- Expiry behavior is correct from the user's perspective (they can't book) without the status flip; the only consequence is reports.

**Drift recognised**: D-003 in spec.md. Reports filtering `WHERE status='expired'` undercount. n8n alerts work because they read the predicate, but admin dashboards may show stale "active" counts.

**Phase 2 candidates**:
- (a) Nightly cron flips `status='expired'` for predicate-positive rows. Costs a write per expiring row.
- (b) Query-time view (Decision 2 trade-off discussion). Zero write cost; reports must use the view.
- (c) Materialized view refreshed nightly. Compromise — cheap reads, controlled writes.

**Recommendation**: (b) — view-based. Aligns with the "exhausted" virtual-state fix.

---

## Decision 5 — SECURITY DEFINER hardening (2026-04-28)

**Choice**: `deduct_package_session()` and `deduct_package_session_mode()` are `SECURITY DEFINER` functions per `supabase/migrations/20260428095637_hardening_security_definer_and_rls.sql:233`.

**Rationale**:
- Callers may be students (booking confirms a session for themselves) whose RLS policies on `student_packages` would block UPDATE without a function bypass.
- SECURITY DEFINER lets the function execute with the function-owner's privileges (`postgres` role typically), bypassing the caller's RLS.
- The 2026-04-28 hardening migration tightened the function's `search_path` and revoked unnecessary grants to ensure the elevation can't be abused.

**Constraint codified in spec.md FR-008**: SECURITY DEFINER MUST be retained. Removing it breaks the deduction path.

**Phase 2 verification**: confirm the function still has `SECURITY DEFINER` in production by reading `\df+ deduct_package_session` — easy check, currently assumed-true.

---

## Decision 6 — Multi-currency pricing in 4 columns (USD, GBP, SAR, AUD), not a separate table

**Choice**: `packages.price_usd`, `price_gbp`, `price_sar`, `price_aud` are 4 columns on the catalog row, not a separate `package_prices(package_id, currency, amount)` table.

**Rationale**:
- 4 known currencies covers Egypt, Kuwait/Gulf, US, UK, Australia — the operator's target geographies.
- Catalog rows are read on the public packages page — keeping prices on the row avoids a JOIN.
- New currencies are a schema migration, but adding currencies is rare (~1/year).

**Trade-off**: schema rigidity for read performance and simplicity. Acceptable for a small, stable currency set.

**Phase 2 candidate**: if a fifth currency is needed, evaluate (a) ALTER TABLE add column vs. (b) migrate to a child table. The choice depends on read access patterns at that point.

---

## References

- `LIFECYCLES.md` §4 — original prose, 5-state simplification of the actual 3-explicit + 2-virtual machine.
- `EXCEPTION_PLAYBOOKS.md` PB-03 (payment fulfillment), PB-07 (delivery alerts).
- `CLAUDE.md` § "SQL Functions" — names `deduct_package_session(uuid)` as canonical.
- `CLAUDE.md` § "Database Migrations Policy" — why migrations live where they do.
- ADR-0004 — atomic-critical-path pattern (the package domain is the cleanest existing example).
- spec 003 (booking) — consumer of `deduct_package_session()` at terminal `completed`.
- `supabase/migrations/20260428095637_hardening_security_definer_and_rls.sql` — hardening migration.
- `supabase/migrations/20260505211356_extend_packages_with_session_modes.sql` — per-mode companion + comment block.
- `supabase/migrations/20260501071453_paypal_payments.sql` — PayPal capture path.
