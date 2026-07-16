// Spec 040 (Stripe Connect payouts) — Slice 3a: the earnings-materialization
// decision, the authoritative agreement-gate enforcement point.
//
// Pure: no Stripe, no DB, no clock. Given a delivered session and the teacher's
// agreement state, it decides the earning entry to insert. The AMOUNT is
// injected (deriveEarningCents from ./earnings is the caller's concern), so this
// unit is independent of the amount math and testable in isolation.
//
// This is the chokepoint referenced by the Slice 3.2 booking-gate PR: the
// create-time gates are UX fast-fails, but enforcement is authoritative HERE
// because it derives from delivered sessions and so covers every path
// (instant/single-session/admin), not just student→teacher booking creation.
//
//   FR-021: a delivery before `connect_cutover_date` (or with the date unset)
//           materializes NOTHING — the legacy monthly-payroll path owns it.
//   FR-029: accepted current version → `pending`; NOT accepted (grace OR
//           hard-gate) → `held`/`agreement_pending`, releasable on acceptance,
//           never voided. Grace is a booking-time concept and does not enter
//           here — materialization only asks "accepted the current version?".
//   FR-030a: the current agreement version is STAMPED (never timestamp-derived),
//            on pending AND held entries alike.
//
// Idempotency (one entry per delivery) is the DB's job — the partial
// UNIQUE(session_delivery_id) WHERE kind='session' — not this pure decision's.

export const AGREEMENT_PENDING_HOLD_REASON = "agreement_pending";

export type MaterializeEarningErrorReason =
  | "invalid_amount"
  | "missing_agreement_version";

// Same posture as ConnectEarningError in ./earnings: a caller contract breach on
// a money path is a structured, catchable exception — never a silently-minted
// zero/negative or unstamped earning.
export class MaterializeEarningError extends Error {
  readonly reason: MaterializeEarningErrorReason;

  constructor(reason: MaterializeEarningErrorReason, message: string) {
    super(message);
    this.name = "MaterializeEarningError";
    this.reason = reason;
  }
}

export interface MaterializeEarningInput {
  sessionDeliveryId: string;
  teacherId: string;
  /** UTC session-completion timestamp (session_deliveries.delivered_at). */
  deliveredAt: Date;
  /** Injected per-delivery earning (deriveEarningCents). Integer cents > 0. */
  earningCents: number;
  /** Whether the teacher has accepted the CURRENT agreement version. */
  acceptedCurrentVersion: boolean;
  /** The current agreement version, stamped on the entry (FR-030a). */
  currentAgreementVersion: string;
  /** platform_settings.connect_cutover_date; null ⇒ Connect path disabled. */
  cutoverDate: Date | null;
}

export interface EarningEntryInsert {
  kind: "session";
  teacher_id: string;
  session_delivery_id: string;
  amount_cents: number;
  agreement_version: string;
  status: "pending" | "held";
  hold_reason: string | null;
}

/**
 * Decide the earning entry to insert for one delivered session, or `null` when
 * the delivery falls outside the Connect cutover partition (dormant path).
 */
export function materializeSessionEarning(
  input: MaterializeEarningInput,
): EarningEntryInsert | null {
  // Dormancy / cutover partition (FR-021): before cutover, nothing accrues here.
  if (input.cutoverDate === null || input.deliveredAt < input.cutoverDate) {
    return null;
  }

  // Fail closed: a session earning is always positive integer cents (the DB
  // CHECK allows negative only for kind='clawback'); a bad injected amount is a
  // caller bug, surfaced here rather than as a rejected INSERT.
  if (!Number.isInteger(input.earningCents) || input.earningCents <= 0) {
    throw new MaterializeEarningError(
      "invalid_amount",
      `earningCents must be a positive integer, got ${input.earningCents}`,
    );
  }

  // A non-blank version MUST be present to stamp — an unstamped (or whitespace)
  // entry makes FR-028a's evidence-retention predicate unanswerable (it keys on
  // agreement_version). Trim so "   " can never masquerade as consent evidence.
  if (input.currentAgreementVersion.trim().length === 0) {
    throw new MaterializeEarningError(
      "missing_agreement_version",
      "currentAgreementVersion must be a non-blank string to stamp the entry",
    );
  }

  const accepted = input.acceptedCurrentVersion;
  return {
    kind: "session",
    teacher_id: input.teacherId,
    session_delivery_id: input.sessionDeliveryId,
    amount_cents: input.earningCents,
    agreement_version: input.currentAgreementVersion,
    status: accepted ? "pending" : "held",
    hold_reason: accepted ? null : AGREEMENT_PENDING_HOLD_REASON,
  };
}
