-- 20260716000200_prepaid_hours_expiry_sweep.sql
--
-- Spec 038 — Prepaid Hour Wallet, Phase 4 (expiry sweep). DB-only.
-- Design authority: spec.md → "Eng-review resolutions" R5, R6, H3 + FR-008/009.
-- Prerequisites:
--   • 20260715000000_prepaid_hour_wallet_schema.sql — prepaid_hours_events table,
--     the partial sweep index idx_student_packages_prepaid_active_expiry
--     (expires_at WHERE product_type='prepaid_hours' AND status='active').
--   • 20260715000100_prepaid_hour_wallet_functions.sql — record_prepaid_event().
--
-- T4.3 (n8n pre-expiry reminder) is OUT OF SCOPE for this migration — it is
-- external n8n config wired against the seeded `prepaid_hours_reminder_lead_days`
-- platform_settings key. Operators: schedule an n8n workflow that queries
-- student_packages WHERE product_type='prepaid_hours' AND status='active' AND
-- expires_at < now() + interval 'N days' (N = reminder_lead_days) and sends the
-- reminder. No DB function is needed for the reminder.
--
-- Three lenses (AGENTS.md §1):
--   🛠 Full-stack: H3 lock+recheck (never erase a concurrently renewed lot);
--                   SECURITY DEFINER with the standard lockdown (NFR-003);
--                   append-only ledger respected (one 'expired' event per swept
--                   lot, only when hours were actually voided).
--   📖 Quran:     n/a (no text/ayah surface).
--   🎓 Platform:  a dormant student never loses hours they're still using —
--                  rolling-window integrity is preserved.
--
-- Expand/contract (AGENTS.md §4): purely additive (one new SECURITY DEFINER
-- function). No DROP/RENAME, no enum/type change, no column change. The
-- migration-safety guard has no breaker pattern to flag.

-- ─────────────────────────────────────────────────────────────────────────────
-- T4.1 — FR-008 defense-in-depth is ALREADY satisfied (no new code)
-- ─────────────────────────────────────────────────────────────────────────────
-- A wallet lot is unspendable the moment it is expired, REGARDLESS of whether
-- the sweep has run, because EVERY charge path filters on it:
--
--   1. selectActivePackage (src/lib/domains/package/ledger.ts)
--        .eq("status", "active")
--      → expired lots (status='expired') are never even returned.
--
--   2. The confirm-time debit trigger deduct_student_package() (latest body in
--      20260715000100) selects with:
--        WHERE status = 'active' AND ... AND (expires_at IS NULL OR expires_at > now())
--      → an expired-but-not-yet-swept lot (status still 'active', expires_at in
--        the past) is excluded by the expires_at predicate alone. The sweep is
--        the cleanup of record, not the precondition.
--
--   3. deduct_package_session(uuid) (latest body in 20260715000100) has the
--      same guard inside its UPDATE:
--        WHERE id = p_package_id AND status = 'active'
--          AND ... AND (expires_at IS NULL OR expires_at > now())
--      → the canonical debit kernel itself refuses an expired lot.
--
-- Therefore: NO new precondition code is added here. FR-008 is satisfied by
-- the existing predicates. This migration only adds the SWEEP that voids
-- dormant lots and appends the 'expired' ledger event (FR-009).

-- ─────────────────────────────────────────────────────────────────────────────
-- T4.2 — sweep_expired_prepaid_hours(): void dormant lots (FR-009, R6, H3)
-- ─────────────────────────────────────────────────────────────────────────────
-- For each prepaid_hours lot that is dormant (status='active' AND
-- expires_at < now()):
--   • lock the row (FOR UPDATE — concurrent grant/draw blocks here),
--   • RE-CHECK expires_at < now() after locking (H3 — never erase a lot that a
--     concurrent draw/reset renewed between SELECT and lock),
--   • flip status='expired' (R6: selectActivePackage + deduct already filter
--     status='active', so the flip auto-excludes the lot from spending — FR-008
--     free; expired lots STAY expired, a new purchase is a new lot per R1),
--   • append ONE 'expired' event capturing the hours voided — but ONLY when
--     sessions_remaining > 0 (the prepaid_hours_events CHECK enforces
--     hours_delta <> 0, so logging -0 is invalid; a fully-drawn-down lot still
--     flips status for audit cleanliness but emits no event because nothing
--     was voided).
--
-- Idempotent: the WHERE status='active' guard means a lot already swept to
-- 'expired' is never re-swept, and no second 'expired' event can be appended.
-- Concurrent sweep invocations are safe via FOR UPDATE SKIP LOCKED (the second
-- worker skips rows the first holds).

CREATE OR REPLACE FUNCTION public.sweep_expired_prepaid_hours()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_swept_count integer := 0;
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT id, sessions_remaining
      FROM public.student_packages
      WHERE product_type = 'prepaid_hours'
        AND status = 'active'
        AND expires_at < now()
      FOR UPDATE SKIP LOCKED
  LOOP
    -- H3 re-check after lock. FOR UPDATE in Postgres already re-evaluates the
    -- WHERE against the latest committed version (so a concurrent draw that
    -- reset expires_at past now() causes the row to drop out of the cursor),
    -- but we re-assert the predicate here as explicit defense-in-depth: never
    -- erase a concurrently renewed lot.
    PERFORM 1
      FROM public.student_packages
      WHERE id = v_row.id
        AND status = 'active'
        AND expires_at < now();
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Flip status. R6: expired lots auto-exclude from every charge path
    -- (status='active' filter in selectActivePackage + deduct_package_session
    -- + deduct_student_package trigger). Expired is a terminal state — a new
    -- purchase is a new immutable lot (R1), never a resurrection.
    UPDATE public.student_packages
      SET status = 'expired'
      WHERE id = v_row.id;

    -- Append the singular 'expired' event capturing hours voided. The ledger
    -- table enforces CHECK (hours_delta <> 0), so a lot that was fully drawn
    -- down (sessions_remaining = 0) emits NO event — there was nothing to
    -- void. Status still flips (audit-clean state); only the event is gated.
    IF v_row.sessions_remaining > 0 THEN
      PERFORM public.record_prepaid_event(
        v_row.id,
        'expired',
        -v_row.sessions_remaining,
        NULL
      );
    END IF;

    v_swept_count := v_swept_count + 1;
  END LOOP;

  RETURN v_swept_count;
END;
$$;

ALTER FUNCTION public.sweep_expired_prepaid_hours() OWNER TO postgres;

-- T2.6-style lockdown (NFR-003): REVOKE from public/anon/authenticated so a
-- JWT-carrying client cannot RPC this directly and void hours; GRANT to
-- service_role only. The cron route calls it via the admin client.
REVOKE EXECUTE ON FUNCTION public.sweep_expired_prepaid_hours() FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sweep_expired_prepaid_hours() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cron wiring (NO route in THIS migration — thin follow-up)
-- ─────────────────────────────────────────────────────────────────────────────
-- This repo's cron mechanism (verified): n8n-triggered Vercel cron routes under
-- src/app/api/cron/<name>/route.ts, each exporting
--   export const GET = withAuthedCronMonitor("cron-<name>", "<schedule>", handler);
-- from @/lib/sentry/cron. n8n (Mac mini) GETs the endpoint with the
-- X-N8N-Secret header; the schedule string is informational (Sentry monitor
-- label). See src/app/api/cron/audit-cleanup/route.ts and
-- src/app/api/cron/reconciliation/route.ts for the canonical pattern. The
-- vercel.json `crons` field is NOT used (moved to n8n 2026-05-03; see
-- audit-cleanup header).
--
-- FOLLOW-UP (out of Phase 4's DB scope): add src/app/api/cron/prepaid-hours-sweep/route.ts:
--   export const GET = withAuthedCronMonitor("cron-prepaid-hours-sweep", "0 4 * * *", async () => {
--     const admin = createAdminClient();
--     const { data, error } = await admin.rpc("sweep_expired_prepaid_hours");
--     if (error) throw new Error(`prepaid-hours-sweep: ${error.message}`);
--     return NextResponse.json({ ok: true, swept: data ?? 0, at: new Date().toISOString() });
--   });
-- Cadence: daily (suggest 04:00 UTC, after the existing 02:00 audit-cleanup and
-- 03:00 reconciliation sweeps). Wire the actual schedule in n8n.
