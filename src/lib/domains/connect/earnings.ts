// Spec 040 (Stripe Connect payouts) — per-delivery earning math.
//
// ONE canonical, fully deterministic integer-cents rule (FR-006), shared by the
// transfer sweep and proven equal to its SQL twin (connect_earning_cents) in the
// parity walk. Pure: no Stripe, no DB, no clock. The rate is the SNAPSHOTTED
// session_deliveries.hourly_rate_usd — never a live re-read.
//
//   rate_cents   = round(hourly_rate_usd * 100)              // <= 2dp, asserted
//   amount_cents = (duration_minutes * rate_cents + 30) / 60 // integer division
//
// The `+ 30` is the round-half-up bias (half of 60): ties go AWAY from zero on
// the exact decimal value, with no binary float in the result.

export type ConnectEarningErrorReason =
  | "missing_or_zero_rate"
  | "rate_precision_exceeded"
  | "invalid_duration"
  | "amount_out_of_range";

// Extends the PayrollException posture in src/lib/domains/attendance/payroll.ts:
// a rate problem is a structured, catchable exception — never a silent $0.
export class ConnectEarningError extends Error {
  readonly reason: ConnectEarningErrorReason;

  constructor(reason: ConnectEarningErrorReason, message: string) {
    super(message);
    this.name = "ConnectEarningError";
    this.reason = reason;
  }
}

export interface DeriveEarningInput {
  /** Minutes actually delivered. Integer > 0 (session_deliveries CHECK). */
  durationMinutes: number;
  /** Snapshotted USD/hour, numeric(10,2): finite, > 0, at most 2 decimals. */
  hourlyRateUsd: number;
}

export function deriveEarningCents(input: DeriveEarningInput): number {
  const { durationMinutes, hourlyRateUsd } = input;

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    throw new ConnectEarningError(
      "invalid_duration",
      `durationMinutes must be a positive integer, got ${durationMinutes}`,
    );
  }

  if (!Number.isFinite(hourlyRateUsd) || hourlyRateUsd <= 0) {
    throw new ConnectEarningError(
      "missing_or_zero_rate",
      `hourlyRateUsd must be a positive finite number, got ${hourlyRateUsd}`,
    );
  }

  // Convert to integer cents and reject anything the numeric(10,2) column could
  // never have held. round() collapses the float representation error first
  // (0.07 * 100 = 7.0000000000000009), then we prove the pre-round value was
  // genuinely within a whole cent — a 3-decimal rate fails here.
  const rateCents = Math.round(hourlyRateUsd * 100);
  if (Math.abs(hourlyRateUsd * 100 - rateCents) > 1e-6) {
    throw new ConnectEarningError(
      "rate_precision_exceeded",
      `hourlyRateUsd must have at most 2 decimals, got ${hourlyRateUsd}`,
    );
  }

  // Reject inputs whose product leaves exact-integer range. This is the SHARED
  // domain bound with the SQL twin (connect_earning_cents): keeping
  // durationMinutes * rateCents within 2^53 means the TS side stays exact, and
  // it is far below the point where the SQL side's bigint would overflow (and
  // Postgres raises rather than wrapping) — so the two can never diverge on a
  // large input. The sweep validates the same session_deliveries domain.
  const product = durationMinutes * rateCents;
  if (!Number.isSafeInteger(product)) {
    throw new ConnectEarningError(
      "amount_out_of_range",
      `durationMinutes * rate exceeds safe integer range (${durationMinutes} min @ ${hourlyRateUsd})`,
    );
  }

  // Integer division only — no float on the payable value.
  return Math.trunc((product + 30) / 60);
}
