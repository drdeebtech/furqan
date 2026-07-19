# Single-session refund — design

**Date:** 2026-07-19
**Status:** design, pending review
**Owner decisions captured:** admin-initiated · mirror prepaid saga · not-yet-delivered only · full refund · dashboard-refund fallback included
**Origin:** last unshipped item of the 2026-07-18 student payment-path audit (`project_payment_audit_fixes`).

---

## 1. Problem

A student can pay for a **single session** (an `assessment` or `specialized` booking, or a
one-time-paid instant session). Unlike packages/subscriptions, a single session is cash-paid:
the `bookings` row has `student_package_id = NULL` and the money lives on a `payments` row
(`payments.booking_id → bookings.id`, `payments.stripe_payment_intent` holds the PI).

Today there is **no way to refund it**. The subscription refund (#736) and the prepaid-hour
refund saga (spec 038) both exist; single-session is the gap. This spec adds an
**admin-initiated** refund that returns the money and cancels the booking, plus a fallback that
keeps the booking honest when a refund is issued directly in the Stripe dashboard.

## 2. Scope (owner decisions)

| Decision | Choice |
|----------|--------|
| Trigger | **Admin action in-app**, mirroring the prepaid saga (`refund-prepaid-hours.ts`). |
| Eligibility | **Only not-yet-delivered** bookings (`status IN ('pending','confirmed')`). Completed / `no_show` are **not** refundable via this action. |
| Effect | Full money-back + booking `→ cancelled` (frees the slot) + notify student & teacher. |
| Amount | **Full charge only** (a single session is indivisible — no partial). |
| Dashboard refunds | **Fallback included** — a refund issued in the Stripe dashboard reconciles the booking (§3.5). |

Out of scope: self-serve student/teacher cancellation-with-refund; completed-session
(dispute/goodwill) refunds; the credit-system trigger fix (see §6, split to its own spec).

## 3. Architecture — cancel-at-finalize saga

Mirrors the prepaid saga **except** the booking is cancelled only when Stripe confirms the
refund (at the webhook), not at reserve. Rationale: a single session is a payment, not a
reusable credit — there is nothing to "make unspendable" in-flight, so deferring the cancel
to finalize removes the prepaid design's slot-restore-on-release trap entirely.

```
admin clicks Refund
  └─ approveSingleSessionRefund({ bookingId })          [server action, requireAdmin]
       ├─ reserve_single_session_refund(booking, reqId) [opens 'pending' saga row; NO cancel yet]
       ├─ stripe.refunds.create(pi, meta, {idempotencyKey: reqId})   [NO amount → full charge]
       │     success → return ok
       │     failure → release_single_session_refund(reqId)  ['released'; booking untouched]
       └─ (later) charge.refunded webhook, refund_kind='single_session'
             └─ finalize_single_session_refund(reqId, refundId)
                  ├─ [shared] cancel booking if pending/confirmed → 'cancelled' (frees slot) + emit
                  │           else (completed/no_show/cancelled) → reconcile + log, DO NOT throw
                  └─ close saga row 'succeeded'

Stripe-dashboard refund (no refund_request_id / refund_kind)
  └─ charge.refunded webhook
       └─ reconcile_external_single_session_refund(payment_intent)   [FALLBACK, §3.5]
            └─ [shared] cancel booking if pending/confirmed → 'cancelled' (frees slot) + emit
                        else → no-op + log. No saga row (external, no admin request).
```

Both the admin finalize and the external reconcile delegate the booking side to **one shared
internal step** (`_cancel_single_session_for_refund(p_booking)`): cancel iff still
`pending`/`confirmed`, emit `booking.cancelled`, otherwise reconcile + log. One cancel path, so
the two entrypoints can never drift.

### 3.1 New table `single_session_refund_requests`

Mutable saga ledger (append-only ledgers can't do `pending → succeeded`). Mirrors
`prepaid_refund_requests`. **Admin path only** — the dashboard fallback writes no request row.

```sql
CREATE TABLE public.single_session_refund_requests (
  id                        uuid primary key,            -- = Stripe idempotencyKey + metadata.refund_request_id
  booking_id                uuid not null references public.bookings(id) on delete restrict,
  stripe_payment_intent     text not null,               -- frozen from payments at reserve (audit)
  stripe_refund_id          text,                        -- set at finalize (re_...)
  amount_usd                numeric(10,2) not null check (amount_usd > 0),  -- audit only; NOT sent to Stripe
  status                    text not null default 'pending'
                              check (status in ('pending','succeeded','released')),
  created_at                timestamptz not null default now(),
  resolved_at               timestamptz
);

-- DOUBLE-REFUND BACKSTOP (see §4): at most one live request per booking.
CREATE UNIQUE INDEX single_session_refund_one_live
  ON public.single_session_refund_requests (booking_id)
  WHERE status <> 'released';

CREATE INDEX idx_ssrr_pi ON public.single_session_refund_requests (stripe_payment_intent);

-- RLS in THIS migration (§3 AGENTS.md): SELECT own (student via booking) or admin; writes
-- service_role only, via the SECURITY DEFINER functions below.
ALTER TABLE public.single_session_refund_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY ssrr_select_own ON public.single_session_refund_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.bookings b
            WHERE b.id = single_session_refund_requests.booking_id
              AND b.student_id = (select auth.uid()))
    OR private.is_admin()
  );
```

### 3.2 Functions (SECURITY DEFINER, standard EXECUTE lockdown → service_role only)

**`reserve_single_session_refund(p_booking uuid, p_refund_request_id uuid) RETURNS numeric`**
- `SELECT ... FOR UPDATE` on the booking (serialize concurrent admin clicks).
- Idempotent on `p_refund_request_id` (same id → return existing `amount_usd`, no re-insert).
- Guards (fail-closed, each a distinct error):
  - booking exists and `status IN ('pending','confirmed')`;
  - a linked payment exists: `payments.booking_id = p_booking AND provider = 'stripe' AND stripe_payment_intent IS NOT NULL`
    — **reject `provider='paypal'`** (those refund through PayPal, mirroring the prepaid guard);
  - no existing non-`released` request for this booking (the unique index is the atomic
    backstop; this explicit check gives a clean error before the insert).
- Insert `'pending'` row with frozen PI + `amount_usd` (from the payments row).
- Return `amount_usd` (audit/UI only — not sent to Stripe).

**`finalize_single_session_refund(p_refund_request_id uuid, p_stripe_ref text) RETURNS jsonb`** (`{did_cancel, booking_id, student_id, teacher_id}`)
- Look up request `FOR UPDATE`; **RAISE** if not found (matches `finalize_prepaid_refund`);
  return early if already `'succeeded'` (webhook redelivery); RAISE if `'released'`.
- Call `_cancel_single_session_for_refund(request.booking_id)` (shared step).
- Close request `'succeeded'`, set `stripe_refund_id`, `resolved_at`.

**`release_single_session_refund(p_refund_request_id uuid) RETURNS void`**
- Close request `'released'`, `resolved_at`. Booking is never touched (never cancelled at
  reserve), so there is no slot-restore problem.

**`reconcile_external_single_session_refund(p_payment_intent text) RETURNS void`** — the §3.5
fallback. Resolve `p_payment_intent → payments.booking_id`; if the booking is a **single-session,
`stripe`-provider** booking (`student_package_id IS NULL`), call
`_cancel_single_session_for_refund(booking_id)`. Idempotent; no-op when no matching
single-session booking (so prepaid/subscription PIs are never touched). Writes no saga row.

**`_cancel_single_session_for_refund(p_booking uuid) RETURNS jsonb`** (`{did_cancel, booking_id, student_id, teacher_id}`) — shared internal.
`SELECT booking FOR UPDATE`: if `status IN ('pending','confirmed')` → `status='cancelled'`
(frees the slot via `bookings_teacher_slot_unique_idx`, which excludes `cancelled`) and emit
`booking.cancelled` (fail-soft). **Else** (`completed`/`no_show`/`cancelled` — the in-flight
window, §5) → **do not update**, log a reconcile warning. Never throws (a throw in the webpath
wedges the webhook with money already refunded).

### 3.3 Server action `approveSingleSessionRefund({ bookingId })`

A near-verbatim mirror of `src/lib/actions/admin/refund-prepaid-hours.ts`:
`requireAdmin()` → zod → `randomUUID()` reqId → `reserve` → `stripe.refunds.create({
payment_intent, metadata: { refund_request_id, refund_kind: 'single_session' } },
{ idempotencyKey: reqId })` **with no `amount`** → on Stripe error call `release` (fail-closed
log if release itself fails) → `revalidatePath('/admin')`.

### 3.4 Webhook wiring (`handleChargeRefunded`, `webhook-handlers.ts`)

In the existing per-refund loop, branch on `refund.metadata.refund_kind` /
`refund.metadata.refund_request_id`:
- `refund_kind === 'single_session'` → `finalize_single_session_refund(refund_request_id, refund.id)`.
- has a `refund_request_id` but not single-session → existing prepaid finalize (unchanged).
- **no `refund_request_id`** (external/dashboard) → existing prepaid H5 reconcile **and** the new
  `reconcile_external_single_session_refund(charge.payment_intent)` (§3.5). The two are disjoint by
  construction (prepaid PIs map to `student_packages`; single-session PIs map to a NULL-package
  booking), so calling both is safe.

The `refund_kind` discriminator is **required** because `finalize_prepaid_refund` RAISES on an
id it doesn't own — the two saga tables cannot share a blind finalize call.

### 3.5 Dashboard-refund fallback (external reconcile)

A refund issued directly in the Stripe dashboard emits `charge.refunded` with **no**
`refund_request_id`/`refund_kind`. Without this fallback the money leaves but the booking stays
`confirmed` with the slot held — a zombie. The fallback (`reconcile_external_single_session_refund`,
above) maps the refunded PI to its single-session booking and runs the same shared cancel step,
so a dashboard refund is as honest as an in-app one. Redelivery-safe (status-guarded no-op).

### 3.6 Admin surface

A "Refund" control on the admin single-session/booking view, calling the action. Exact
component located during planning (reuse the prepaid refund button's pattern).

## 4. The double-refund guard (do not skip)

Cancel-at-finalize removes prepaid's natural guard (balance depletion). The Stripe
`idempotencyKey` is a fresh `randomUUID()` per click → it dedupes retries of one request, **not
two independent clicks**, and Stripe keys expire in 24h. Two admin clicks would otherwise mean
two `stripe.refunds.create` on the same charge. Guard = **`SELECT booking FOR UPDATE` in
reserve** + the **`UNIQUE (booking_id) WHERE status <> 'released'`** partial index as the atomic
backstop. The DB uniqueness is authoritative; the idempotency key is not.

## 5. Known limitations

- **In-flight window:** between a successful Stripe refund and the `charge.refunded` webhook, a
  teacher could theoretically deliver the session. The shared cancel step tolerates it
  (reconcile + log, no throw); money is already refunded — an operator reconciles. Low risk
  (admin refunds a session that isn't happening).
- **Unscheduled bookings hold no slot:** `assessment`/`specialized` are created `pending` with
  `scheduled_at = NULL`; the slot unique index ignores NULLs, so "frees the slot" only applies
  once a time is chosen. Cancel is still correct.

## 6. Credit-system interaction — none (system retired)

There is **no** credit interaction. The legacy `student_credits` system — the
`t_deduct_student_credit` / `t_restore_student_credit` triggers, both trigger functions, and the
`student_credits` table — was **retired on 2026-07-12** (migrations
`20260712000001_retire_legacy_student_credit_trigger.sql` and
`20260712000002_retire_student_credits_system.sql`). Cancelling a booking fires no credit trigger,
so this refund has zero credit-side effects.

> Correction (2026-07-19): an earlier draft of this section reasoned about those triggers as live
> and proposed a follow-up "credit floating-counter guard" spec. That was based on the baseline
> schema (`20260428`) and missed the later retirement migrations — it is superseded. There is no
> bug to guard and no follow-up spec.

## 7. Verification

- **DB rolled-back walk** (BEGIN..ROLLBACK, local 127.0.0.1:54322): reserve→finalize cancels
  the booking + frees the slot; a second reserve for the same booking is blocked by the unique
  index; release leaves the booking intact; finalize on an already-`completed` booking is a
  no-throw reconcile; **external reconcile** cancels a dashboard-refunded single session and is a
  no-op for a prepaid/subscription PI and on redelivery.
- **From-zero `supabase db reset`** replays the new migration clean (exit 0).
- **Unit tests:** the action (Stripe success / failure→release), the webhook `refund_kind`
  dispatch + external-reconcile branch, and the reserve guards (PayPal reject, wrong-status
  reject, double-request reject).
- Migration is **expand/contract-safe** (purely additive: one table, five functions, RLS in
  the same migration — no breaker for `check-migration-safety.sh`).

## 8. Three-lens sign-off

- 🛠 **Full-stack:** money op is `FOR UPDATE` + unique-index guarded; SECURITY DEFINER with the
  standard lockdown; RLS ships in-migration; full-charge refund sidesteps amount/tax; webhook is
  the single source of truth (no non-atomic Stripe/DB window); finalize + external reconcile are
  redelivery-idempotent and wedge-proof; one shared cancel step so admin and dashboard paths
  can't diverge.
- 📖 **Quran:** n/a — single sessions are Quran recitation bookings, but a refund touches only
  money + booking status; no ayah text, tajweed, or `surah:ayah` data.
- 🎓 **Teaching-platform:** refund is honest (money back + booking cancelled), whether issued
  in-app or via the dashboard, and cancellation emits `booking.cancelled` so the student sees a
  cancelled+refunded session and the teacher learns the slot reopened — not a silent
  disappearance.
