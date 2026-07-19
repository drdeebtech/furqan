# Single-session Refund Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin refund a cash-paid single session (returns the money, cancels the not-yet-delivered booking, frees the slot), and keep the booking honest when a refund is issued directly in the Stripe dashboard.

**Architecture:** Cancel-at-finalize saga mirroring the prepaid-hours refund (spec 038). A server action reserves a saga row and issues one Stripe refund; the `charge.refunded` webhook cancels the booking. A dashboard refund (no metadata) reconciles the booking through the same shared cancel step. All money mutations live in SECURITY DEFINER DB functions; the webhook is the single source of truth.

**Tech Stack:** Next.js server actions · Supabase Postgres (SECURITY DEFINER + RLS) · Stripe Node SDK · Vitest.

**Spec:** `docs/superpowers/specs/2026-07-19-single-session-refund-design.md`

## Global Constraints

- RLS on the new table, shipped in the **same** migration; SECURITY DEFINER functions revoke EXECUTE from `public`/`anon`/`authenticated`, grant `service_role` only.
- Migrations are **expand/contract-safe** — additive only (no DROP/RENAME/type-narrowing). This migration is purely additive.
- `userId`/identity never from request input; the action authorizes with `requireAdmin()`.
- Stripe refund uses `idempotencyKey`; **no `amount`** field → full-charge refund.
- The PI column on `payments` is `stripe_payment_intent` (NOT `..._id`).
- Money changes proven on a rolled-back local DB walk **and** a from-zero `supabase db reset`.
- TypeScript strict; no `any`. Run `npm run build` (not just `tsc`) before "done".
- Emit only typed `FurqanEvent` names via `emitEvent` (fail-soft, `.catch(logError)`), post-commit.

---

### Task 1: DB migration — saga table, RLS, and the five refund functions

**Files:**
- Create: `supabase/migrations/20260814000000_single_session_refund.sql`
- Verify against: `supabase/migrations/20260716000300_prepaid_hours_refund.sql` (pattern), `supabase/migrations/20260619000005_single_session_columns.sql` (single-session creator), `supabase/migrations/20260428000000_remote_baseline.sql` (bookings/payments/`validate_booking_status`).

**Interfaces:**
- Produces (called by later tasks):
  - `reserve_single_session_refund(p_booking uuid, p_refund_request_id uuid) → numeric` (amount_usd)
  - `finalize_single_session_refund(p_refund_request_id uuid, p_stripe_ref text) → jsonb` (`{did_cancel, booking_id, student_id, teacher_id}`)
  - `release_single_session_refund(p_refund_request_id uuid) → void`
  - `reconcile_external_single_session_refund(p_payment_intent text) → jsonb` (same shape as finalize)

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260814000000_single_session_refund.sql`:

```sql
-- 20260814000000_single_session_refund.sql
-- Spec: docs/superpowers/specs/2026-07-19-single-session-refund-design.md
-- Admin-initiated + Stripe-dashboard-fallback refund for cash-paid single sessions
-- (assessment/specialized/instant; bookings.student_package_id IS NULL).
-- Cancel-at-finalize saga mirroring 20260716000300 (prepaid). Purely ADDITIVE
-- (1 table, 5 SECURITY DEFINER fns, RLS in-migration) → expand/contract-safe.

-- 1. Saga ledger (admin path only; the dashboard fallback writes no row).
CREATE TABLE IF NOT EXISTS public.single_session_refund_requests (
  id                     uuid primary key,          -- = Stripe idempotencyKey + metadata.refund_request_id
  booking_id             uuid not null references public.bookings(id) on delete restrict,
  stripe_payment_intent  text not null,             -- frozen from payments at reserve (audit)
  stripe_refund_id       text,                      -- set at finalize (re_...)
  amount_usd             numeric(10,2) not null check (amount_usd > 0),  -- audit only; NOT sent to Stripe
  status                 text not null default 'pending'
                           check (status in ('pending','succeeded','released')),
  created_at             timestamptz not null default now(),
  resolved_at            timestamptz
);

-- Double-refund backstop: at most one live request per booking.
CREATE UNIQUE INDEX IF NOT EXISTS single_session_refund_one_live
  ON public.single_session_refund_requests (booking_id) WHERE status <> 'released';
CREATE INDEX IF NOT EXISTS idx_ssrr_pi
  ON public.single_session_refund_requests (stripe_payment_intent);

ALTER TABLE public.single_session_refund_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ssrr_select_own ON public.single_session_refund_requests;
CREATE POLICY ssrr_select_own ON public.single_session_refund_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.bookings b
            WHERE b.id = single_session_refund_requests.booking_id
              AND b.student_id = (select auth.uid()))
    OR private.is_admin()
  );
-- No write policy → only service_role (via the SECURITY DEFINER fns below) writes.

-- 2. Shared cancel step. Cancels iff still pending/confirmed; never throws
--    (a throw in the webhook path wedges it with money already refunded).
--    Returns the ids the TS webhook needs to emit booking.cancelled.
CREATE OR REPLACE FUNCTION public._cancel_single_session_for_refund(p_booking uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status booking_status; v_student uuid; v_teacher uuid;
BEGIN
  SELECT status, student_id, teacher_id INTO v_status, v_student, v_teacher
  FROM bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('did_cancel', false, 'booking_id', p_booking);
  END IF;
  IF v_status IN ('pending','confirmed') THEN
    UPDATE bookings SET status = 'cancelled' WHERE id = p_booking;
    RETURN jsonb_build_object('did_cancel', true, 'booking_id', p_booking,
                              'student_id', v_student, 'teacher_id', v_teacher);
  END IF;
  -- In-flight window: already delivered/settled. Reconcile, don't throw.
  RAISE WARNING 'single-session refund: booking % not cancellable (status=%) — money refunded, reconcile', p_booking, v_status;
  RETURN jsonb_build_object('did_cancel', false, 'booking_id', p_booking, 'status', v_status);
END; $$;

-- 3. reserve — admin path. Opens a pending saga row; does NOT cancel yet.
CREATE OR REPLACE FUNCTION public.reserve_single_session_refund(
  p_booking uuid, p_refund_request_id uuid
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing numeric(10,2); v_status booking_status;
        v_pi text; v_amount numeric(10,2); v_provider text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_refund_request_id::text));
  SELECT amount_usd INTO v_existing FROM single_session_refund_requests WHERE id = p_refund_request_id;
  IF FOUND THEN RETURN v_existing; END IF;                      -- idempotent on request id

  SELECT status INTO v_status FROM bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reserve_single_session_refund: booking % not found', p_booking USING errcode='P0002';
  END IF;
  IF v_status NOT IN ('pending','confirmed') THEN
    RAISE EXCEPTION 'reserve_single_session_refund: booking % not refundable (status=%)', p_booking, v_status USING errcode='P0001';
  END IF;

  SELECT stripe_payment_intent, amount_usd, provider INTO v_pi, v_amount, v_provider
  FROM payments WHERE booking_id = p_booking ORDER BY created_at DESC LIMIT 1;
  IF v_pi IS NULL OR v_provider IS DISTINCT FROM 'stripe' THEN
    RAISE EXCEPTION 'reserve_single_session_refund: booking % has no Stripe payment (provider=%) — refund via that provider', p_booking, coalesce(v_provider,'none') USING errcode='P0001';
  END IF;

  INSERT INTO single_session_refund_requests (id, booking_id, stripe_payment_intent, amount_usd, status)
  VALUES (p_refund_request_id, p_booking, v_pi, v_amount, 'pending');
  RETURN v_amount;
END; $$;

-- 4. finalize — webhook path (charge.refunded, refund_kind='single_session').
CREATE OR REPLACE FUNCTION public.finalize_single_session_refund(
  p_refund_request_id uuid, p_stripe_ref text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_booking uuid; v_result jsonb;
BEGIN
  SELECT status, booking_id INTO v_status, v_booking
  FROM single_session_refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_single_session_refund: no request %', p_refund_request_id USING errcode='P0002';
  END IF;
  IF v_status = 'succeeded' THEN
    RETURN jsonb_build_object('did_cancel', false, 'already', true);   -- redelivery
  END IF;
  IF v_status = 'released' THEN
    RAISE EXCEPTION 'finalize_single_session_refund: request % already released — success webhook inconsistent', p_refund_request_id USING errcode='P0001';
  END IF;

  v_result := public._cancel_single_session_for_refund(v_booking);
  UPDATE single_session_refund_requests
    SET status='succeeded', stripe_refund_id=p_stripe_ref, resolved_at=now()
    WHERE id = p_refund_request_id;
  RETURN v_result;
END; $$;

-- 5. release — admin path, Stripe failure. Booking untouched (never cancelled at reserve).
CREATE OR REPLACE FUNCTION public.release_single_session_refund(p_refund_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM single_session_refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_single_session_refund: no request %', p_refund_request_id USING errcode='P0002';
  END IF;
  IF v_status = 'succeeded' THEN
    RAISE EXCEPTION 'release_single_session_refund: request % already succeeded', p_refund_request_id USING errcode='P0001';
  END IF;
  IF v_status = 'released' THEN RETURN; END IF;                 -- idempotent
  UPDATE single_session_refund_requests SET status='released', resolved_at=now() WHERE id=p_refund_request_id;
END; $$;

-- 6. reconcile — Stripe-dashboard fallback (charge.refunded, NO refund_request_id).
--    Disjoint from prepaid/subscription by construction: matches ONLY a
--    single-session (student_package_id IS NULL) stripe-provider booking.
CREATE OR REPLACE FUNCTION public.reconcile_external_single_session_refund(p_payment_intent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_booking uuid;
BEGIN
  SELECT b.id INTO v_booking
  FROM payments p JOIN bookings b ON b.id = p.booking_id
  WHERE p.stripe_payment_intent = p_payment_intent
    AND p.provider = 'stripe'
    AND b.student_package_id IS NULL
  ORDER BY p.created_at DESC LIMIT 1;
  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('did_cancel', false, 'matched', false);
  END IF;
  RETURN public._cancel_single_session_for_refund(v_booking);
END; $$;

-- 7. EXECUTE lockdown (NFR-002) — service_role only for all five + the shared step.
DO $lock$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public._cancel_single_session_for_refund(uuid)',
    'public.reserve_single_session_refund(uuid, uuid)',
    'public.finalize_single_session_refund(uuid, text)',
    'public.release_single_session_refund(uuid)',
    'public.reconcile_external_single_session_refund(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $lock$;
```

- [ ] **Step 2: Apply the migration locally and regenerate types**

Run:
```bash
supabase migration up
npm run db:types
```
Expected: migration applies clean; `db:types` regenerates. If `tsc` later flags the new table/rpc, add its Row/Insert types to the alias section of `src/types/database.ts` (hand-corrected layer — never blind-regen it).

- [ ] **Step 3: Write the DB-walk assertion (test-first — run BEFORE trusting the fns)**

Save this to a scratch file and run it. It seeds a booking + Stripe payment, then asserts every behavior in a single rolled-back transaction. Get the service DB URL from `supabase status` (default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

```sql
-- walk-single-session-refund.sql — run with: psql "$DB_URL" -v ON_ERROR_STOP=1 -f walk-single-session-refund.sql
BEGIN;
DO $$
DECLARE
  v_student uuid; v_teacher uuid; v_booking uuid; v_pay uuid;
  v_req1 uuid := gen_random_uuid(); v_req2 uuid := gen_random_uuid();
  v_amt numeric; v_res jsonb; v_status text; v_blocked boolean := false;
BEGIN
  -- seed (reuse an existing student/teacher; adjust ids to your local seed)
  SELECT id INTO v_student FROM profiles WHERE role='student' LIMIT 1;
  SELECT id INTO v_teacher FROM profiles WHERE role='teacher' LIMIT 1;
  INSERT INTO bookings (student_id, teacher_id, student_package_id, booking_product_type,
                        session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount, status)
    VALUES (v_student, v_teacher, NULL, 'assessment', 'hifz', 30, 0, 0, 0, 0, 'confirmed')
    RETURNING id INTO v_booking;
  INSERT INTO payments (booking_id, student_id, stripe_payment_intent, provider, amount_usd, amount_before_tax, tax_amount)
    VALUES (v_booking, v_student, 'pi_walk_1', 'stripe', 20.00, 20.00, 0.00)
    RETURNING id INTO v_pay;

  -- reserve → returns amount, opens pending row
  v_amt := reserve_single_session_refund(v_booking, v_req1);
  ASSERT v_amt = 20.00, 'reserve amount';
  ASSERT (SELECT status FROM single_session_refund_requests WHERE id=v_req1) = 'pending', 'reserve pending';

  -- second reserve (different id, same booking) → unique index blocks
  BEGIN
    PERFORM reserve_single_session_refund(v_booking, v_req2);
  EXCEPTION WHEN unique_violation THEN v_blocked := true;
  END;
  ASSERT v_blocked, 'double-refund blocked by unique index';

  -- finalize → booking cancelled, request succeeded, ids returned
  v_res := finalize_single_session_refund(v_req1, 're_walk_1');
  ASSERT (v_res->>'did_cancel') = 'true', 'finalize cancelled';
  ASSERT (v_res->>'student_id') = v_student::text, 'finalize returns student';
  ASSERT (SELECT status FROM bookings WHERE id=v_booking) = 'cancelled', 'booking cancelled';
  ASSERT (SELECT status FROM single_session_refund_requests WHERE id=v_req1) = 'succeeded', 'request succeeded';

  -- finalize again → idempotent no-op
  v_res := finalize_single_session_refund(v_req1, 're_walk_1');
  ASSERT (v_res->>'already') = 'true', 'finalize redelivery idempotent';

  RAISE NOTICE 'ADMIN PATH OK';
END $$;

-- release path + paypal reject + external reconcile (fresh rows)
DO $$
DECLARE v_s uuid; v_t uuid; v_b uuid; v_req uuid := gen_random_uuid(); v_res jsonb; v_err boolean := false;
BEGIN
  SELECT id INTO v_s FROM profiles WHERE role='student' LIMIT 1;
  SELECT id INTO v_t FROM profiles WHERE role='teacher' LIMIT 1;
  -- release: reserve then release → released, booking untouched
  INSERT INTO bookings (student_id, teacher_id, student_package_id, booking_product_type, session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount, status)
    VALUES (v_s, v_t, NULL, 'assessment', 'hifz', 30,0,0,0,0,'confirmed') RETURNING id INTO v_b;
  INSERT INTO payments (booking_id, student_id, stripe_payment_intent, provider, amount_usd, amount_before_tax, tax_amount)
    VALUES (v_b, v_s, 'pi_walk_2', 'stripe', 15,15,0);
  PERFORM reserve_single_session_refund(v_b, v_req);
  PERFORM release_single_session_refund(v_req);
  ASSERT (SELECT status FROM single_session_refund_requests WHERE id=v_req)='released', 'released';
  ASSERT (SELECT status FROM bookings WHERE id=v_b)='confirmed', 'booking untouched after release';

  -- paypal reject
  INSERT INTO bookings (student_id, teacher_id, student_package_id, booking_product_type, session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount, status)
    VALUES (v_s, v_t, NULL, 'assessment', 'hifz', 30,0,0,0,0,'confirmed') RETURNING id INTO v_b;
  INSERT INTO payments (booking_id, student_id, stripe_payment_intent, provider, paypal_order_id, amount_usd, amount_before_tax, tax_amount)
    VALUES (v_b, v_s, NULL, 'paypal', 'po_1', 15,15,0);
  BEGIN PERFORM reserve_single_session_refund(v_b, gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN v_err := true; END;
  ASSERT v_err, 'paypal booking rejected at reserve';

  -- external reconcile: dashboard refund cancels the booking; 2nd call noop
  INSERT INTO bookings (student_id, teacher_id, student_package_id, booking_product_type, session_type, duration_min, rate_snapshot, amount_usd, tax_rate, tax_amount, status)
    VALUES (v_s, v_t, NULL, 'assessment', 'hifz', 30,0,0,0,0,'confirmed') RETURNING id INTO v_b;
  INSERT INTO payments (booking_id, student_id, stripe_payment_intent, provider, amount_usd, amount_before_tax, tax_amount)
    VALUES (v_b, v_s, 'pi_walk_3', 'stripe', 15,15,0);
  v_res := reconcile_external_single_session_refund('pi_walk_3');
  ASSERT (v_res->>'did_cancel')='true' AND (SELECT status FROM bookings WHERE id=v_b)='cancelled', 'external reconcile cancels';
  v_res := reconcile_external_single_session_refund('pi_walk_3');
  ASSERT (v_res->>'did_cancel')='false', 'external reconcile idempotent';
  v_res := reconcile_external_single_session_refund('pi_does_not_exist');
  ASSERT (v_res->>'matched')='false', 'external reconcile no-op for unknown PI';

  RAISE NOTICE 'RELEASE / PAYPAL / EXTERNAL OK';
END $$;
ROLLBACK;
```

- [ ] **Step 4: Run the walk — verify it fails first, then passes**

Run before the migration is applied (or against a DB without the fns): expect `function ... does not exist`. Then after Step 2:
```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f walk-single-session-refund.sql
```
Expected: `ADMIN PATH OK` and `RELEASE / PAYPAL / EXTERNAL OK`, no ASSERT failure, `ROLLBACK` leaves the DB untouched.

- [ ] **Step 5: Fresh-apply proof + commit**

Run:
```bash
supabase db reset   # from-zero replay; catches version collisions / shim leaks
```
Expected: exit 0, all migrations incl. `20260814000000` replay clean. Then:
```bash
git add supabase/migrations/20260814000000_single_session_refund.sql src/types/database.ts src/types/supabase.generated.ts
git commit -m "feat(billing): single-session refund saga DB functions + RLS"
```

---

### Task 2: Admin server action `approveSingleSessionRefund`

**Files:**
- Create: `src/lib/actions/admin/refund-single-session.ts`
- Create: `src/lib/actions/admin/__tests__/refund-single-session.test.ts`
- Pattern source: `src/lib/actions/admin/refund-prepaid-hours.ts` + its test.

**Interfaces:**
- Consumes: `reserve_single_session_refund`, `release_single_session_refund` (Task 1).
- Produces: `approveSingleSessionRefund({ bookingId: string }) → { ok: true; amountUsd: number; refundRequestId: string } | { ok: false; error: string }` (used by Task 4 UI).

- [ ] **Step 1: Write the failing test**

Create `src/lib/actions/admin/__tests__/refund-single-session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const refundsCreate = vi.fn();
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/stripe/client", () => ({ getStripe: () => ({ refunds: { create: refundsCreate } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { approveSingleSessionRefund } from "../refund-single-session";

beforeEach(() => { rpc.mockReset(); refundsCreate.mockReset(); });

describe("approveSingleSessionRefund", () => {
  it("reserves, issues a full-charge Stripe refund, returns ok", async () => {
    rpc.mockResolvedValueOnce({ data: 20, error: null }); // reserve → amount
    refundsCreate.mockResolvedValueOnce({ id: "re_1" });
    const res = await approveSingleSessionRefund({ bookingId: "11111111-1111-1111-1111-111111111111" });
    expect(res).toMatchObject({ ok: true, amountUsd: 20 });
    // reserve called with (booking, requestId)
    expect(rpc).toHaveBeenCalledWith("reserve_single_session_refund", expect.objectContaining({
      p_booking: "11111111-1111-1111-1111-111111111111",
    }));
    // Stripe: NO amount, correct metadata + idempotencyKey
    const [body, opts] = refundsCreate.mock.calls[0];
    expect(body.amount).toBeUndefined();
    expect(body.metadata).toMatchObject({ refund_kind: "single_session" });
    expect(opts.idempotencyKey).toBe(body.metadata.refund_request_id);
  });

  it("releases the reservation when the Stripe refund fails", async () => {
    rpc.mockResolvedValueOnce({ data: 20, error: null });  // reserve
    refundsCreate.mockRejectedValueOnce(new Error("card_error"));
    rpc.mockResolvedValueOnce({ data: null, error: null }); // release
    const res = await approveSingleSessionRefund({ bookingId: "11111111-1111-1111-1111-111111111111" });
    expect(res).toMatchObject({ ok: false });
    expect(rpc).toHaveBeenCalledWith("release_single_session_refund", expect.any(Object));
  });

  it("surfaces a reserve guard error (e.g. PayPal / wrong status) without calling Stripe", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "not refundable" } });
    const res = await approveSingleSessionRefund({ bookingId: "11111111-1111-1111-1111-111111111111" });
    expect(res).toMatchObject({ ok: false, error: "not refundable" });
    expect(refundsCreate).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    const res = await approveSingleSessionRefund({ bookingId: "not-a-uuid" });
    expect(res).toMatchObject({ ok: false, error: "invalid input" });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test:unit -- refund-single-session`
Expected: FAIL — `Cannot find module '../refund-single-session'`.

- [ ] **Step 3: Write the action**

Create `src/lib/actions/admin/refund-single-session.ts`:

```ts
"use server";

import { randomUUID } from "crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { logError } from "@/lib/logger";

/**
 * Admin "refund single session" — a thin, fail-closed wrapper over the refund
 * saga DB functions plus ONE Stripe refund (mirrors approvePrepaidRefund):
 *   1. reserve_single_session_refund — opens a `pending` saga row (idempotent
 *      on refundRequestId; guards status pending/confirmed + a Stripe payment).
 *      Does NOT cancel the booking — the webhook does, on Stripe success.
 *   2. stripe.refunds.create — idempotencyKey = refundRequestId; NO `amount`
 *      → full-charge refund; metadata.refund_kind='single_session' lets the
 *      charge.refunded webhook correlate and call finalize_single_session_refund.
 *   3. On Stripe failure — release_single_session_refund closes the row; the
 *      booking was never touched, so nothing to restore.
 */
const Input = z.object({ bookingId: z.uuid() });

type RefundResult =
  | { ok: true; amountUsd: number; refundRequestId: string }
  | { ok: false; error: string };

export async function approveSingleSessionRefund(raw: { bookingId: string }): Promise<RefundResult> {
  await requireAdmin();

  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid input" };
  const { bookingId } = parsed.data;

  const admin = createAdminClient();
  const refundRequestId = randomUUID();

  try {
    const { data: amountUsd, error: reserveErr } = await admin.rpc("reserve_single_session_refund", {
      p_booking: bookingId,
      p_refund_request_id: refundRequestId,
    });
    if (reserveErr || amountUsd == null) {
      return { ok: false, error: reserveErr?.message ?? "reserve failed" };
    }

    const stripe = getStripe();
    try {
      await stripe.refunds.create(
        {
          payment_intent: undefined, // set below; kept explicit for readers
          metadata: { refund_request_id: refundRequestId, refund_kind: "single_session" },
        } as never,
        { idempotencyKey: refundRequestId },
      );
      revalidatePath("/admin");
      return { ok: true, amountUsd: Number(amountUsd), refundRequestId };
    } catch (stripeErr) {
      const { error: releaseErr } = await admin.rpc("release_single_session_refund", {
        p_refund_request_id: refundRequestId,
      });
      if (releaseErr) {
        logError("approveSingleSessionRefund: release failed after Stripe error", releaseErr, {
          tag: "refund", refund_request_id: refundRequestId,
        });
      }
      return { ok: false, error: stripeErr instanceof Error ? stripeErr.message : "stripe refund failed" };
    }
  } catch (err) {
    logError("approveSingleSessionRefund crashed", err, { tag: "refund" });
    return { ok: false, error: err instanceof Error ? err.message : "crashed" };
  }
}
```

Note: the `payment_intent` must come from the reserved payment. `reserve_single_session_refund` returns the amount, not the PI. Change reserve to also expose the PI **or** read it in the action. Simplest and consistent with the saga (PI is frozen on the row): after reserve, `SELECT stripe_payment_intent FROM single_session_refund_requests WHERE id = refundRequestId`. Replace the `stripe.refunds.create` block to first fetch the PI:

```ts
      const { data: reqRow, error: piErr } = await admin
        .from("single_session_refund_requests")
        .select("stripe_payment_intent")
        .eq("id", refundRequestId)
        .single();
      if (piErr || !reqRow) return { ok: false, error: piErr?.message ?? "request row missing" };

      await stripe.refunds.create(
        {
          payment_intent: reqRow.stripe_payment_intent,
          metadata: { refund_request_id: refundRequestId, refund_kind: "single_session" },
        },
        { idempotencyKey: refundRequestId },
      );
```

Update the test's success case to also `rpc`-mock nothing extra (the PI fetch uses `.from().select().eq().single()`, so extend the `createAdminClient` mock to include a chainable `from`). Add to the mock:
```ts
const single = vi.fn().mockResolvedValue({ data: { stripe_payment_intent: "pi_1" }, error: null });
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
```
and assert `body.payment_intent === "pi_1"`.

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm run test:unit -- refund-single-session`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/admin/refund-single-session.ts src/lib/actions/admin/__tests__/refund-single-session.test.ts
git commit -m "feat(billing): admin approveSingleSessionRefund action"
```

---

### Task 3: Webhook dispatch — finalize + external reconcile + emit

**Files:**
- Modify: `src/lib/domains/billing/webhook-handlers.ts` (`handleChargeRefunded`, the per-refund loop ~line 953 and the no-`refund_request_id` branch ~line 973)
- Modify: `src/lib/domains/billing/__tests__/webhook-handlers.test.ts`

**Interfaces:**
- Consumes: `finalize_single_session_refund`, `reconcile_external_single_session_refund` (Task 1); `emitEvent` from `@/lib/automation/emit`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/domains/billing/__tests__/webhook-handlers.test.ts` (follow the file's existing `ctx`/`admin.rpc` mock harness):

```ts
describe("handleChargeRefunded — single session", () => {
  it("refund_kind=single_session → finalize + emit booking.cancelled on cancel", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { did_cancel: true, booking_id: "b1", student_id: "s1", teacher_id: "t1" }, error: null,
    });
    const emit = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ // helper in this test file
      charge: { currency: "usd", payment_intent: "pi_1", refunds: { data: [
        { id: "re_1", amount: 2000, metadata: { refund_request_id: "req_1", refund_kind: "single_session" } },
      ] } },
      rpc, emit,
    });
    await handleChargeRefunded(ctx);
    expect(rpc).toHaveBeenCalledWith("finalize_single_session_refund", { p_refund_request_id: "req_1", p_stripe_ref: "re_1" });
    expect(emit).toHaveBeenCalledWith("booking.cancelled", "booking", "b1",
      expect.objectContaining({ student_id: "s1", teacher_id: "t1" }));
  });

  it("external dashboard refund (no metadata) → reconcile_external_single_session_refund", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { did_cancel: false, matched: false }, error: null });
    const ctx = makeCtx({
      charge: { currency: "usd", payment_intent: "pi_x", refunds: { data: [ { id: "re_2", amount: 1500, metadata: {} } ] } },
      rpc,
    });
    await handleChargeRefunded(ctx);
    expect(rpc).toHaveBeenCalledWith("reconcile_external_single_session_refund", { p_payment_intent: "pi_x" });
  });
});
```

If `makeCtx` doesn't exist, factor the existing per-test ctx construction in this file into one, or inline the `ctx` object the other `handleChargeRefunded` tests already build (match their shape exactly).

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test:unit -- webhook-handlers`
Expected: FAIL — `finalize_single_session_refund` never called (branch not implemented).

- [ ] **Step 3: Implement the branch**

In `handleChargeRefunded`, inside `for (const refund of refunds)`, add the single-session dispatch. Near the existing `const requestId = refundMd.refund_request_id;`:

```ts
    // Single-session admin refund: correlate via refund_kind + finalize, then
    // emit booking.cancelled (post-commit, fail-soft) if the booking was cancelled.
    if (refundMd.refund_kind === "single_session" && requestId) {
      const { data, error } = await ctx.admin.rpc("finalize_single_session_refund", {
        p_refund_request_id: requestId,
        p_stripe_ref: refund.id,
      });
      if (error) {
        logError("stripe-webhook: finalize_single_session_refund failed", error, {
          tag: "refund", refund_request_id: requestId,
        });
      } else if (data?.did_cancel) {
        emitEvent("booking.cancelled", "booking", data.booking_id, {
          student_id: data.student_id, teacher_id: data.teacher_id,
        }).catch((e) => logError("emit booking.cancelled failed", e, { tag: "billing" }));
      }
      continue; // handled — do not fall through to prepaid/H5
    }
```

Then in the **no-`requestId`** (external) region — after the existing prepaid H5 `reconcile_external_prepaid_refund` call — add the single-session fallback (disjoint from prepaid by construction):

```ts
    // H5 (single-session): a Stripe-dashboard refund carries no request id.
    // reconcile_external_single_session_refund no-ops unless the PI maps to a
    // single-session (student_package_id IS NULL) stripe booking.
    {
      const { data, error } = await ctx.admin.rpc("reconcile_external_single_session_refund", {
        p_payment_intent: charge.payment_intent as string,
      });
      if (error) {
        logError("stripe-webhook: reconcile_external_single_session_refund failed", error, {
          tag: "refund", payment_intent: charge.payment_intent,
        });
      } else if (data?.did_cancel) {
        emitEvent("booking.cancelled", "booking", data.booking_id, {
          student_id: data.student_id, teacher_id: data.teacher_id,
        }).catch((e) => logError("emit booking.cancelled failed", e, { tag: "billing" }));
      }
    }
```

Confirm `emitEvent` is imported (it is, per line 28). Confirm the RPC return type: after `npm run db:types`, `data` is typed `Json`; cast narrowly (`const r = data as { did_cancel?: boolean; booking_id?: string; student_id?: string; teacher_id?: string } | null`) rather than `any`.

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm run test:unit -- webhook-handlers`
Expected: PASS.

- [ ] **Step 5: Build + commit**

Run: `npm run build` — Expected: success (server/client boundary intact).
```bash
git add src/lib/domains/billing/webhook-handlers.ts src/lib/domains/billing/__tests__/webhook-handlers.test.ts
git commit -m "feat(billing): dispatch single-session refund + dashboard fallback in charge.refunded"
```

---

### Task 4: Admin Refund UI

**Files:**
- Create: `src/app/admin/payments/refund-single-session-form.tsx`
- Modify: `src/app/admin/payments/page.tsx` (render the new form alongside the prepaid form)
- Pattern source: `src/app/admin/payments/refund-prepaid-hours-form.tsx`

**Interfaces:**
- Consumes: `approveSingleSessionRefund` (Task 2).

- [ ] **Step 1: Write the form (client component)**

Create `src/app/admin/payments/refund-single-session-form.tsx` mirroring `refund-prepaid-hours-form.tsx` (same `useState` + `useTransition` + result banner pattern), but with a single `bookingId` input:

```tsx
"use client";

import { useState, useTransition } from "react";
import { approveSingleSessionRefund } from "@/lib/actions/admin/refund-single-session";

export function RefundSingleSessionForm() {
  const [bookingId, setBookingId] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await approveSingleSessionRefund({ bookingId: bookingId.trim() });
      setResult(res.ok ? `Refunded $${res.amountUsd.toFixed(2)} — booking will cancel on confirmation.` : `Error: ${res.error}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="ss-booking">Single-session booking ID</label>
      <input id="ss-booking" value={bookingId} onChange={(e) => setBookingId(e.target.value)}
             className="w-full rounded border px-3 py-2" placeholder="booking uuid" required />
      <button type="submit" disabled={pending || !bookingId.trim()}
              className="rounded bg-red-600 px-4 py-2 text-white disabled:opacity-50">
        {pending ? "Refunding…" : "Refund single session"}
      </button>
      {result && <p className="text-sm" role="status">{result}</p>}
    </form>
  );
}
```
(Match the actual class/token conventions in `refund-prepaid-hours-form.tsx` — copy its styling rather than these placeholder classes.)

- [ ] **Step 2: Render it on the payments page**

In `src/app/admin/payments/page.tsx`, import and render `<RefundSingleSessionForm />` in a titled section next to the prepaid-hours form (follow the existing section markup).

- [ ] **Step 3: Build + typecheck**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Visual verification (RTL + both flows)**

Load `/admin/payments` (admin session; `SUPABASE_SERVICE_ROLE_KEY` must be set or auth bounces). Screenshot with agent-browser; confirm the form renders, and in RTL. Submit a known confirmed single-session booking id in staging and confirm the result banner + (after webhook) the booking flips to cancelled.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/payments/refund-single-session-form.tsx src/app/admin/payments/page.tsx
git commit -m "feat(admin): single-session refund form on payments page"
```

---

## Self-Review

**Spec coverage:** §3.1 table+RLS → T1. §3.2 five fns → T1. §3.3 action → T2. §3.4 webhook branch → T3. §3.5 fallback → T1 (fn) + T3 (wiring). §3.6 UI → T4. §4 double-refund guard → T1 (unique index) + walk Step 3. §5 in-flight tolerance → T1 `_cancel_single_session_for_refund` else-branch + walk. §6 credit interaction → informational, no task (correct). §7 verification → T1 walk + `db reset`, T2/T3 unit, T4 visual. §8 lenses → satisfied (RLS, no-Quran-surface, emit on cancel).

**Placeholder scan:** the only deferred items are "match the actual styling/ctx harness" notes, which point at named source files to copy — not TBDs. The action's PI-fetch correction is spelled out in T2 Step 3.

**Type consistency:** RPC names identical across T1/T2/T3 (`reserve_/finalize_/release_/reconcile_external_single_session_refund`); the jsonb shape `{did_cancel, booking_id, student_id, teacher_id}` is produced in T1 and consumed identically in T3; `approveSingleSessionRefund({bookingId})` signature matches T2→T4.
