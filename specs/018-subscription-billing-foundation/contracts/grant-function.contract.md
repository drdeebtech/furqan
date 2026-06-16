# Contract: `grant_subscription_cycle(...)` SQL function

Atomic, idempotent payment + credit grant. SECURITY DEFINER, `search_path = public`. The **only** path that writes a subscription-driven `student_packages` grant.

## Signature

```sql
grant_subscription_cycle(
  p_subscription_id uuid,
  p_student_id uuid,
  p_plan_id uuid,
  p_cycle_key text,
  p_stripe_payment_intent text,
  p_amount_cents int,
  p_credit_count int,
  p_expires_at timestamptz,
  p_session_metadata jsonb
) RETURNS uuid
```

## Semantics (one transaction)

1. **Idempotency short-circuit**: `SELECT id FROM student_packages WHERE billing_cycle_key = p_cycle_key` → if found, RETURN it (no payment, no grant).
2. **Payment**: INSERT into `payments` (`provider='stripe'`, `stripe_payment_intent=p_stripe_payment_intent`, `amount_usd` from cents, `status='succeeded'`) ON CONFLICT (`stripe_payment_intent`) DO NOTHING.
3. **Grant**: INSERT into `student_packages` (`student_id`, `sessions_total=p_credit_count`, `status='active'`, `expires_at=p_expires_at`, `session_mode_used=p_session_metadata`, `subscription_id`, `billing_cycle_key=p_cycle_key`).
4. RETURN new grant id.

## Guarantees (verified locally, NFR-003)

- Called twice with same `p_cycle_key` → exactly **1** grant, **1** payment.
- Distinct `p_cycle_key` (renewal) → new grant; prior grant untouched (additive, AGENTS.md §4 — never overwrite/reset).
- `p_credit_count` & price are passed by the caller from the **catalog**, never the client.

## Lockdown (NFR-002)

```sql
REVOKE ALL ON FUNCTION grant_subscription_cycle(...) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION grant_subscription_cycle(...) TO service_role;
```
