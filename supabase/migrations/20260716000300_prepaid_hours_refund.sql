-- 20260716000300_prepaid_hours_refund.sql
--
-- Spec 038 — Prepaid Hour Wallet, Phase 5 (refund saga). DB + webhook helpers.
-- Design authority: spec.md → "Eng-review resolutions" R8 (webhook-driven saga,
-- reserve-voids-hours), H5 (external refunds/chargebacks), FR-011.
-- Prerequisites:
--   • 20260715000000_prepaid_hour_wallet_schema.sql — student_packages columns
--     (rate_paid_usd frozen, stripe_payment_intent_id), prepaid_hours_events.
--   • 20260715000100_prepaid_hour_wallet_functions.sql — record_prepaid_event().
--
-- Design (R8): a pending refund needs a MUTABLE record (the append-only
-- prepaid_hours_events can't do pending→succeeded). The reserve step VOIDS the
-- hours NOW (sessions_used += p_hours) so they're immediately unspendable while
-- the Stripe call is in flight; the KEPT hours stay active/spendable → a
-- PARTIAL refund does NOT lock or status-change the lot. On Stripe success the
-- webhook finalizes (ledger event + close request); on Stripe failure the
-- admin path releases (un-void the hours). External Stripe-side refunds /
-- chargebacks (H5) are reconciled by voiding the lot's remaining hours.
--
-- Three lenses (AGENTS.md §1):
--   🛠 Full-stack: every money op FOR UPDATE + idempotency claim; SECURITY
--                   DEFINER with the standard lockdown; RLS on the new table
--                   ships in THIS migration; append-only ledger respected.
--   📖 Quran:     n/a.
--   🎓 Platform:  refund-on-request is honest — money back, hours voided, no
--                  surprise spendable balance after reversal.
--
-- Expand/contract (AGENTS.md §4): purely additive (one new table, four new
-- SECURITY DEFINER functions). No DROP/RENAME, no enum/type change. The
-- migration-safety guard has no breaker pattern to flag.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. prepaid_refund_requests — mutable saga ledger (R8)
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per admin-approved refund request. id = the refund_request_id used
-- as the Stripe idempotency key (so the DB row and the Stripe refund are
-- 1:1). status lifecycle: pending → succeeded (webhook) | released (Stripe
-- failure). Hours are voided at `pending` (reserve), restored at `released`
-- (release). The `succeeded` transition does NOT touch hours (already voided
-- at reserve); it only appends the 'refunded' ledger event + closes the row.

CREATE TABLE IF NOT EXISTS public.prepaid_refund_requests (
  id                        uuid primary key,
  package_id                uuid not null references public.student_packages(id) on delete restrict,
  hours                     integer not null check (hours > 0),
  amount_usd                numeric(10,2) not null check (amount_usd > 0),
  stripe_payment_intent_id  text not null,           -- frozen from the lot at reserve (audit)
  stripe_refund_id          text,                    -- set at finalize (the re_... id)
  status                    text not null default 'pending'
                              check (status in ('pending','succeeded','released')),
  created_at                timestamptz not null default now(),
  resolved_at               timestamptz
);

comment on table public.prepaid_refund_requests is
  'Mutable saga ledger for prepaid-hour refund requests (spec 038 R8). One row per admin-approved refund; id = Stripe idempotency key. pending→succeeded (webhook finalized) or pending→released (Stripe failure). Hours voided at reserve; restored at release.';
comment on column public.prepaid_refund_requests.hours is
  'Hours to refund (<= lot.sessions_remaining at reserve time). Voided immediately at reserve; restored on release.';
comment on column public.prepaid_refund_requests.amount_usd is
  'hours × lot.rate_paid_usd (frozen at purchase, R8). NOT the current prepaid_hours_rate_usd setting.';
comment on column public.prepaid_refund_requests.status is
  'pending = reserved, awaiting Stripe webhook. succeeded = webhook finalized (hours voided, ledger event appended). released = Stripe failure (hours restored).';

-- Lookups: student-facing "my refund requests" (by package), H5 external
-- reconciliation audit (by PI), status-filtered admin views.
CREATE INDEX IF NOT EXISTS idx_prepaid_refund_requests_package
  ON public.prepaid_refund_requests (package_id);
CREATE INDEX IF NOT EXISTS idx_prepaid_refund_requests_pi
  ON public.prepaid_refund_requests (stripe_payment_intent_id);

-- RLS — enabled + SELECT-only policy in THIS migration (§3 / NFR-002).
ALTER TABLE public.prepaid_refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prepaid_refund_requests_select_own ON public.prepaid_refund_requests;
CREATE POLICY prepaid_refund_requests_select_own ON public.prepaid_refund_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.student_packages sp
      WHERE sp.id = prepaid_refund_requests.package_id
        AND sp.student_id = (select auth.uid())
    )
    OR private.is_admin()
  );
-- No INSERT/UPDATE/DELETE policy → only service_role (bypasses RLS) can write,
-- via the SECURITY DEFINER functions below.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. reserve_prepaid_refund — T5.1 admin path (voids hours, opens saga)
-- ─────────────────────────────────────────────────────────────────────────────
-- (p_lot uuid, p_hours int, p_refund_request_id uuid) RETURNS numeric (amount)
--
-- Idempotent on p_refund_request_id (the Stripe idempotency key): a second call
-- with the same id returns the existing amount WITHOUT re-voiding. Two
-- concurrency guards:
--   • pg_advisory_xact_lock on the refund_request_id serializes same-id calls
--     (different lots or not).
--   • FOR UPDATE on the lot serializes same-lot refunds; the over-refund check
--     uses the post-lock sessions_remaining so two concurrent refunds on the
--     same lot cannot collectively exceed the balance.
--
-- Voiding = sessions_used += p_hours (drops remaining by p_hours immediately).
-- The lot's status is NOT changed — kept hours stay active/spendable, so a
-- PARTIAL refund keeps the rest usable. amount = p_hours × lot.rate_paid_usd
-- (frozen at purchase, R8 — never re-read from settings).

CREATE OR REPLACE FUNCTION public.reserve_prepaid_refund(
  p_lot uuid,
  p_hours int,
  p_refund_request_id uuid
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_amount numeric(10,2);
  v_remaining integer;
  v_rate numeric(10,2);
  v_pi text;
  v_amount numeric(10,2);
BEGIN
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: p_hours must be > 0 (got %)', p_hours
      USING ERRCODE = 'P0001';
  END IF;
  IF p_refund_request_id IS NULL THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: p_refund_request_id is required'
      USING ERRCODE = 'P0001';
  END IF;

  -- Serialize same-id concurrent calls (idempotency race backstop).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_refund_request_id::text, 0));

  -- Idempotent pre-check: a pending/succeeded request with this id already
  -- exists → return its amount without re-voiding.
  SELECT amount_usd INTO v_existing_amount
    FROM public.prepaid_refund_requests
    WHERE id = p_refund_request_id;
  IF v_existing_amount IS NOT NULL THEN
    RETURN v_existing_amount;
  END IF;

  -- Lock + validate the lot. product_type gate is the money-correctness rail:
  -- only prepaid_hours lots have a frozen rate_paid_usd and a stripe_payment_intent_id.
  SELECT sessions_remaining, rate_paid_usd, stripe_payment_intent_id
    INTO v_remaining, v_rate, v_pi
    FROM public.student_packages
    WHERE id = p_lot
      AND product_type = 'prepaid_hours'
      AND status = 'active'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: lot % is not an active prepaid_hours lot', p_lot
      USING ERRCODE = 'P0001';
  END IF;

  -- Block over-refund (defense-in-depth; the lot lock already serialized
  -- same-lot refunds so v_remaining is the post-lock truth).
  IF p_hours > v_remaining THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: over-refund — requesting % hours, lot % has % remaining',
      p_hours, p_lot, v_remaining
      USING ERRCODE = 'P0001';
  END IF;

  -- Frozen rate sanity. Subscription/legacy rows have NULL rate but are already
  -- excluded by the product_type gate; this guards a corrupt lot row.
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RAISE EXCEPTION 'reserve_prepaid_refund: lot % has no frozen rate_paid_usd', p_lot
      USING ERRCODE = 'P0001';
  END IF;

  v_amount := p_hours * v_rate;

  -- VOID the hours now (R8): immediately unspendable. Kept hours stay active.
  UPDATE public.student_packages
    SET sessions_used = sessions_used + p_hours
    WHERE id = p_lot;

  -- Insert the saga row. PK (id) UNIQUE is the structural idempotency backstop
  -- in case the advisory lock was somehow bypassed.
  INSERT INTO public.prepaid_refund_requests (
    id, package_id, hours, amount_usd, stripe_payment_intent_id, status
  )
  VALUES (
    p_refund_request_id, p_lot, p_hours, v_amount, v_pi, 'pending'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN v_amount;
END;
$$;

ALTER FUNCTION public.reserve_prepaid_refund(uuid, int, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reserve_prepaid_refund(uuid, int, uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reserve_prepaid_refund(uuid, int, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. finalize_prepaid_refund — T5.2 webhook path (ledger event + close)
-- ─────────────────────────────────────────────────────────────────────────────
-- (p_refund_request_id uuid, p_stripe_ref text DEFAULT NULL) RETURNS void
--
-- Called from the charge.refunded webhook when the Stripe refund lands.
-- Idempotent: if status='succeeded', no-op. If 'released' (Stripe-failure path
-- ran first), RAISE — money never moved, so a success webhook for this request
-- is inconsistent and must surface loudly (operator reconciliation).
--
-- Does NOT touch sessions_used — hours were voided at reserve. This only:
--   • stamps stripe_refund_id,
--   • flips status → 'succeeded' + resolved_at,
--   • appends ONE 'refunded' event capturing the voided hours.

CREATE OR REPLACE FUNCTION public.finalize_prepaid_refund(
  p_refund_request_id uuid,
  p_stripe_ref text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_refund_request_id::text, 0));

  SELECT package_id, hours, stripe_payment_intent_id, status
    INTO v_row
    FROM public.prepaid_refund_requests
    WHERE id = p_refund_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalize_prepaid_refund: no prepaid_refund_requests row for %', p_refund_request_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: already finalized.
  IF v_row.status = 'succeeded' THEN
    RETURN;
  END IF;

  -- Inconsistent: the release path (Stripe failure) ran first, but now a
  -- success webhook arrived. Surface loudly — the operator must reconcile.
  IF v_row.status = 'released' THEN
    RAISE EXCEPTION 'finalize_prepaid_refund: request % was already released (Stripe failure) — success webhook is inconsistent', p_refund_request_id
      USING ERRCODE = 'P0001';
  END IF;

  -- status is 'pending'. Close it + stamp the Stripe refund id (audit).
  UPDATE public.prepaid_refund_requests
    SET status = 'succeeded',
        stripe_refund_id = COALESCE(p_stripe_ref, stripe_refund_id),
        resolved_at = now()
    WHERE id = p_refund_request_id;

  -- Append the singular 'refunded' event (hours were voided at reserve; this
  -- is the ledger record of the money side settling).
  PERFORM public.record_prepaid_event(
    v_row.package_id, 'refunded', -v_row.hours, COALESCE(p_stripe_ref, v_row.stripe_payment_intent_id)
  );
END;
$$;

ALTER FUNCTION public.finalize_prepaid_refund(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.finalize_prepaid_refund(uuid, text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.finalize_prepaid_refund(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. release_prepaid_refund — Stripe-failure path (restore voided hours)
-- ─────────────────────────────────────────────────────────────────────────────
-- (p_refund_request_id uuid) RETURNS void
--
-- Called by the admin action when stripe.refunds.create throws. Idempotent:
-- if status <> 'pending', no-op. Else RESTORE the voided hours on the lot
-- (sessions_used -= hours, clamped at 0), mark 'released' + resolved_at. No
-- 'refunded' event is appended (money never moved).

CREATE OR REPLACE FUNCTION public.release_prepaid_refund(p_refund_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_refund_request_id::text, 0));

  SELECT package_id, hours, status
    INTO v_row
    FROM public.prepaid_refund_requests
    WHERE id = p_refund_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_prepaid_refund: no prepaid_refund_requests row for %', p_refund_request_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: not pending → no-op.
  IF v_row.status <> 'pending' THEN
    RETURN;
  END IF;

  -- Restore the voided hours. GREATEST clamp is defense-in-depth (sessions_used
  -- can never go negative; the table CHECK sessions_used <= sessions_total is
  -- the structural backstop). The lot's status is untouched — if it was active
  -- at reserve time it stays active; if it expired in the very narrow window
  -- between reserve and release, the restore still decrements sessions_used
  -- (audit-clean) but the restored hours are on an expired lot (rare; the
  -- operator can re-grant manually if needed).
  UPDATE public.student_packages
    SET sessions_used = GREATEST(sessions_used - v_row.hours, 0)
    WHERE id = v_row.package_id;

  UPDATE public.prepaid_refund_requests
    SET status = 'released', resolved_at = now()
    WHERE id = p_refund_request_id;
END;
$$;

ALTER FUNCTION public.release_prepaid_refund(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.release_prepaid_refund(uuid) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_prepaid_refund(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. reconcile_external_prepaid_refund — H5 external reversal (Stripe dashboard / chargeback)
-- ─────────────────────────────────────────────────────────────────────────────
-- (p_payment_intent text) RETURNS void
--
-- Called from the charge.refunded / charge.dispute.created webhook when a
-- prepaid_hours lot's PI is reversed OUTSIDE our admin saga (Stripe dashboard
-- refund, or a dispute/chargeback). Voids the lot's STILL-REMAINING hours so
-- the wallet cannot stay spendable after money is reversed.
--
-- Idempotent: if the lot has 0 remaining (already voided by a prior call or by
-- the sweep), no-op. Does NOT append a duplicate 'refunded' event.

CREATE OR REPLACE FUNCTION public.reconcile_external_prepaid_refund(p_payment_intent text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_remaining integer;
BEGIN
  IF p_payment_intent IS NULL THEN
    RAISE EXCEPTION 'reconcile_external_prepaid_refund: p_payment_intent is required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT id, sessions_remaining INTO v_id, v_remaining
    FROM public.student_packages
    WHERE stripe_payment_intent_id = p_payment_intent
      AND product_type = 'prepaid_hours'
    FOR UPDATE;

  -- Not a prepaid lot (subscription / legacy / unknown PI) → nothing to do.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Idempotent: already voided.
  IF v_remaining IS NULL OR v_remaining <= 0 THEN
    RETURN;
  END IF;

  -- Void ALL remaining hours on this lot. The wallet balance for this lot drops
  -- to zero; the student cannot spend reversed money.
  UPDATE public.student_packages
    SET sessions_used = sessions_used + v_remaining
    WHERE id = v_id;

  PERFORM public.record_prepaid_event(
    v_id, 'refunded', -v_remaining, p_payment_intent
  );
END;
$$;

ALTER FUNCTION public.reconcile_external_prepaid_refund(text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reconcile_external_prepaid_refund(text) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reconcile_external_prepaid_refund(text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- T5.4 — admin surface (NOT built in this migration; thin follow-up)
-- ─────────────────────────────────────────────────────────────────────────────
-- The admin "approve refund" server action is a thin wrapper over the three
-- fns above + one Stripe call. Skeleton (paste into a new server action, e.g.
-- src/lib/actions/admin/refund-prepaid-hours.ts):
--
--   "use server";
--   import { randomUUID } from "crypto";
--   import { requireAdmin } from "@/lib/auth/require-admin";
--   import { createAdminClient } from "@/lib/supabase/admin";
--   import { getStripe } from "@/lib/stripe/client";
--   import { logError } from "@/lib/logger";
--   import { revalidatePath } from "next/cache";
--   import type { Database } from "@/types/supabase.generated";
--   import type { SupabaseClient } from "@supabase/supabase-js";
--
--   export async function approvePrepaidRefund(args: {
--     lotId: string;
--     hours: number;
--   }): Promise<{ ok: true; amountUsd: number; refundRequestId: string } | { ok: false; error: string }> {
--     await requireAdmin();
--     const admin = createAdminClient();
--     const refundRequestId = randomUUID();
--     try {
--       // 1. Reserve — voids hours, opens pending request.
--       const { data: amountUsd, error: reserveErr } = await admin.rpc("reserve_prepaid_refund", {
--         p_lot: args.lotId,
--         p_hours: args.hours,
--         p_refund_request_id: refundRequestId,
--       });
--       if (reserveErr || amountUsd == null) {
--         return { ok: false, error: reserveErr?.message ?? "reserve failed" };
--       }
--       // 2. Issue the Stripe refund with idempotency_key = refund_request_id
--       //    so a retry NEVER double-refunds. metadata.refund_request_id lets
--       //    the charge.refunded webhook correlate back to finalize_prepaid_refund.
--       const lot = await fetchLot(admin, args.lotId);
--       const stripe = getStripe();
--       try {
--         const refund = await stripe.refunds.create({
--           payment_intent: lot.stripe_payment_intent_id,
--           amount: Math.round(Number(amountUsd) * 100),
--           metadata: { refund_request_id: refundRequestId },
--         }, { idempotency_key: refundRequestId });
--         // NOTE: do NOT call finalize here — the charge.refunded webhook is the
--         // source of truth that finalizes (R8). This avoids a Stripe/DB
--         // non-atomic window.
--         revalidatePath("/admin");
--         return { ok: true, amountUsd: Number(amountUsd), refundRequestId };
--       } catch (stripeErr) {
--         // 3a. Stripe failed — release the reservation so the student's hours
--         // come back. Fail-closed: if release itself fails, the hours stay
--         // voided and the operator reconciles manually (better to err on the
--         // side of held-than-spent for a refund in flight).
--         const { error: releaseErr } = await admin.rpc("release_prepaid_refund", {
--           p_refund_request_id: refundRequestId,
--         });
--         if (releaseErr) {
--           logError("approvePrepaidRefund: release failed after Stripe error", releaseErr, {
--             tag: "refund", refund_request_id: refundRequestId,
--           });
--         }
--         return { ok: false, error: stripeErr instanceof Error ? stripeErr.message : "stripe refund failed" };
--       }
--     } catch (err) {
--       logError("approvePrepaidRefund crashed", err, { tag: "refund" });
--       return { ok: false, error: err instanceof Error ? err.message : "crashed" };
--     }
--   }
--
--   async function fetchLot(admin: SupabaseClient<Database>, lotId: string) {
--     const { data, error } = await admin
--       .from("student_packages")
--       .select("id, stripe_payment_intent_id, rate_paid_usd")
--       .eq("id", lotId)
--       .eq("product_type", "prepaid_hours")
--       .single();
--     if (error || !data) throw new Error("lot not found");
--     return data;
--   }
