-- 20260803000000_connect_account_functions.sql
--
-- Spec 040 (Stripe Connect payouts) — Phase 1 tail: the ConnectAccountsStore
-- SQL half. Three SECURITY DEFINER functions backing
-- src/lib/domains/connect/connect-accounts-store.ts via the typed callRpc
-- seam, mirroring 20260801000000_connect_sweep_functions.sql exactly:
--   * SECURITY DEFINER + REVOKE FROM public, anon, authenticated / GRANT
--     service_role (spec-016 lesson — name anon+authenticated explicitly),
--     pinned search_path, OWNER TO postgres.
--   * Each function is ONE atomic statement (or a short serialized sequence);
--     the concurrency guarantees live HERE, not in TS.
--
-- EXPAND (backward-compatible, CLAUDE.md §4): only CREATE FUNCTION + GRANTs.
-- DORMANT: nothing calls these until the Phase 2 onboarding action and the
-- Phase 3 account.updated webhook ship.
--
-- ⚠ BINDING Phase 3 requirements recorded here (from pre-merge review):
--   * Stripe `event.created` has 1-second resolution, so the `<=` recency
--     guard in connect_apply_account_status cannot order two DIFFERENT
--     same-second events. The account.updated handler MUST NOT trust the
--     event snapshot on ties — it must `accounts.retrieve` the authoritative
--     state (or dedupe by event id) before applying.
--   * An account.updated arriving BEFORE connect_link_account commits returns
--     'unknown_account'. For accounts carrying our metadata
--     (furqan_teacher_id) the handler must re-fetch/retry rather than
--     silently dropping the snapshot.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. connect_get_account — read the teacher's mirror row (or nothing)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION connect_get_account(p_teacher_id uuid)
RETURNS TABLE (
  teacher_id        uuid,
  stripe_account_id text,
  charges_enabled   boolean,
  payouts_enabled   boolean,
  details_submitted boolean,
  requirements      jsonb,
  last_event_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sca.teacher_id, sca.stripe_account_id, sca.charges_enabled,
         sca.payouts_enabled, sca.details_submitted, sca.requirements,
         sca.last_event_at
    FROM stripe_connect_accounts sca
   WHERE sca.teacher_id = p_teacher_id;
$$;

ALTER FUNCTION connect_get_account(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_get_account(uuid)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_get_account(uuid)
  TO service_role;

COMMENT ON FUNCTION connect_get_account(uuid) IS
  'Spec 040 FR-001/FR-004: read a teacher''s Connect mirror row. Service-role only (the ConnectAccountsStore seam).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. connect_link_account — insert-or-verify the one-time account link
-- ─────────────────────────────────────────────────────────────────────────
-- FR-001: at most one Connect account per teacher. Two racing onboarding
-- calls hold the SAME acct id (Stripe idempotency key connect-account:{id});
-- the advisory xact lock serializes same-teacher calls so the race resolves
-- to: first INSERTs, second (after the lock releases) lands on the verify
-- branch and sees an identical id → no-op.
--
-- The INSERT's ON CONFLICT is deliberately BARE (no arbiter): the table has
-- TWO unique constraints — UNIQUE(teacher_id) AND UNIQUE(stripe_account_id) —
-- and `ON CONFLICT (teacher_id)` only suppresses conflicts on that one index;
-- a conflict on stripe_account_id would surface as a raw 23505 (empirically
-- reproduced at ~15% under same-id concurrency in pre-merge review). Bare
-- DO NOTHING covers both, and every conflict then falls through to the verify
-- branch, which raises the branded error for any genuine mismatch. A
-- DIFFERENT id on an already-linked row raises loudly (and the one-time
-- trigger guard_stripe_connect_accounts_identity backstops any UPDATE path).
CREATE OR REPLACE FUNCTION connect_link_account(
  p_teacher_id uuid,
  p_stripe_account_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing text;
BEGIN
  IF p_stripe_account_id IS NULL OR btrim(p_stripe_account_id) = '' THEN
    RAISE EXCEPTION 'connect_link_account: stripe_account_id must be non-empty';
  END IF;

  -- Serialize same-teacher linking (released at transaction end). Keyed on
  -- the teacher, so unrelated teachers never contend.
  PERFORM pg_advisory_xact_lock(hashtext('connect_link_account:' || p_teacher_id::text));

  INSERT INTO stripe_connect_accounts (teacher_id, stripe_account_id)
  VALUES (p_teacher_id, p_stripe_account_id)
  ON CONFLICT DO NOTHING;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Row already exists: link if unlinked, else verify it is EXACTLY this id.
  UPDATE stripe_connect_accounts
     SET stripe_account_id = p_stripe_account_id
   WHERE teacher_id = p_teacher_id
     AND stripe_account_id IS NULL;

  IF FOUND THEN
    RETURN;
  END IF;

  SELECT stripe_account_id INTO v_existing
    FROM stripe_connect_accounts
   WHERE teacher_id = p_teacher_id;

  IF v_existing IS DISTINCT FROM p_stripe_account_id THEN
    -- Covers both: this teacher already linked to a different id, AND the
    -- rarer app-bug case where the id is already linked to ANOTHER teacher
    -- (v_existing is NULL because this teacher has no row — the bare
    -- ON CONFLICT swallowed a stripe_account_id collision above).
    RAISE EXCEPTION
      'connect_link_account: teacher % cannot link account — teacher already linked to a different account, or the account id is already in use (one-time link, FR-001)',
      p_teacher_id;
  END IF;
  -- Identical id → idempotent replay, no-op.
END;
$$;

ALTER FUNCTION connect_link_account(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_link_account(uuid, text)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_link_account(uuid, text)
  TO service_role;

COMMENT ON FUNCTION connect_link_account(uuid, text) IS
  'Spec 040 FR-001: insert-or-verify the one-time teacher→Stripe account link, serialized per teacher via advisory xact lock. Idempotent for the same id; loud for a conflicting id. Service-role only.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. connect_apply_account_status — recency-guarded mirror write (FR-003)
-- ─────────────────────────────────────────────────────────────────────────
-- ONE conditional UPDATE: the recency guard (last_event_at IS NULL OR
-- last_event_at <= p_event_at) is INSIDE the statement, so a stale
-- out-of-order account.updated matches 0 rows and never overwrites newer
-- state — and never trips the trigger's backwards-clock exception. Equal
-- timestamps are allowed for idempotent same-event replays; two DIFFERENT
-- same-second events cannot be ordered here — that is the binding Phase 3
-- requirement in the header (handler must accounts.retrieve on ties).
-- Returns 'applied' | 'stale' | 'unknown_account' for loud-but-expected
-- handling in the webhook handler.
CREATE OR REPLACE FUNCTION connect_apply_account_status(
  p_stripe_account_id text,
  p_charges_enabled   boolean,
  p_payouts_enabled   boolean,
  p_details_submitted boolean,
  p_requirements      jsonb,
  p_event_at          timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE stripe_connect_accounts
     SET charges_enabled   = p_charges_enabled,
         payouts_enabled   = p_payouts_enabled,
         details_submitted = p_details_submitted,
         requirements      = p_requirements,
         last_event_at     = p_event_at
   WHERE stripe_account_id = p_stripe_account_id
     AND (last_event_at IS NULL OR last_event_at <= p_event_at);

  IF FOUND THEN
    RETURN 'applied';
  END IF;

  IF EXISTS (SELECT 1 FROM stripe_connect_accounts
              WHERE stripe_account_id = p_stripe_account_id) THEN
    RETURN 'stale';
  END IF;

  RETURN 'unknown_account';
END;
$$;

ALTER FUNCTION connect_apply_account_status(text, boolean, boolean, boolean, jsonb, timestamptz) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION connect_apply_account_status(text, boolean, boolean, boolean, jsonb, timestamptz)
  FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION connect_apply_account_status(text, boolean, boolean, boolean, jsonb, timestamptz)
  TO service_role;

COMMENT ON FUNCTION connect_apply_account_status(text, boolean, boolean, boolean, jsonb, timestamptz) IS
  'Spec 040 FR-003: recency-guarded Connect status mirror write. Stale events match 0 rows (returns ''stale''); unknown accounts write nothing (returns ''unknown_account''). Service-role only.';
