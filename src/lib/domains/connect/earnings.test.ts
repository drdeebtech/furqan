import { describe, it, expect } from "vitest";

import { deriveEarningCents, ConnectEarningError } from "./earnings";

// FR-006: one canonical, fully deterministic integer-cents rule from the
// SNAPSHOTTED hourly_rate_usd (numeric(10,2)), round-half-up (ties away from
// zero), NO binary floating point in the result. FR-007: a missing/zero rate
// MUST surface as a structured exception, never a $0 (or guessed) payout.
//
//   rate_cents   = round(hourly_rate_usd * 100)              // <= 2dp, asserted
//   amount_cents = (duration_minutes * rate_cents + 30) / 60 // integer division

describe("deriveEarningCents", () => {
  describe("canonical amounts", () => {
    it("30 min @ $20.00 → 1000 cents (matches the Slice 1 walk fixture)", () => {
      expect(deriveEarningCents({ durationMinutes: 30, hourlyRateUsd: 20 })).toBe(1000);
    });

    it("60 min @ $20.00 → 2000 cents", () => {
      expect(deriveEarningCents({ durationMinutes: 60, hourlyRateUsd: 20 })).toBe(2000);
    });

    it("45 min @ $20.00 → 1500 cents", () => {
      expect(deriveEarningCents({ durationMinutes: 45, hourlyRateUsd: 20 })).toBe(1500);
    });
  });

  describe("round-half-up (ties away from zero)", () => {
    it("1 min @ $1.00 → 2 cents (1.667¢ rounds up)", () => {
      expect(deriveEarningCents({ durationMinutes: 1, hourlyRateUsd: 1 })).toBe(2);
    });

    it("3 min @ $0.10 → 1 cent (exact 0.5¢ tie rounds AWAY from zero)", () => {
      expect(deriveEarningCents({ durationMinutes: 3, hourlyRateUsd: 0.1 })).toBe(1);
    });

    it("9 min @ $0.10 → 2 cents (exact 1.5¢ tie rounds up)", () => {
      expect(deriveEarningCents({ durationMinutes: 9, hourlyRateUsd: 0.1 })).toBe(2);
    });

    it("1 min @ $0.10 → 0 cents (0.167¢ rounds down; a valid sub-cent earning, NOT an error — the rate is non-zero)", () => {
      expect(deriveEarningCents({ durationMinutes: 1, hourlyRateUsd: 0.1 })).toBe(0);
    });
  });

  describe("float safety", () => {
    it("$0.07 does not mis-round (0.07 * 100 = 7.0000000000000009 in JS)", () => {
      // 60 min @ $0.07 → rate_cents must be exactly 7, giving 7 cents, not 6.
      expect(deriveEarningCents({ durationMinutes: 60, hourlyRateUsd: 0.07 })).toBe(7);
    });

    it("$29.99 → rate_cents exactly 2999, 60 min → 2999 cents", () => {
      expect(deriveEarningCents({ durationMinutes: 60, hourlyRateUsd: 29.99 })).toBe(2999);
    });
  });

  describe("fail-closed on invalid rate (FR-007)", () => {
    it("throws missing_or_zero_rate for rate 0", () => {
      expect(() => deriveEarningCents({ durationMinutes: 30, hourlyRateUsd: 0 })).toThrow(
        ConnectEarningError,
      );
      try {
        deriveEarningCents({ durationMinutes: 30, hourlyRateUsd: 0 });
      } catch (e) {
        expect((e as ConnectEarningError).reason).toBe("missing_or_zero_rate");
      }
    });

    it("throws missing_or_zero_rate for a negative rate", () => {
      try {
        deriveEarningCents({ durationMinutes: 30, hourlyRateUsd: -5 });
        throw new Error("did not throw");
      } catch (e) {
        expect(e).toBeInstanceOf(ConnectEarningError);
        expect((e as ConnectEarningError).reason).toBe("missing_or_zero_rate");
      }
    });

    it("throws missing_or_zero_rate for NaN rate", () => {
      try {
        deriveEarningCents({ durationMinutes: 30, hourlyRateUsd: Number.NaN });
        throw new Error("did not throw");
      } catch (e) {
        expect((e as ConnectEarningError).reason).toBe("missing_or_zero_rate");
      }
    });

    it("throws rate_precision_exceeded for a rate with more than 2 decimals (20.001)", () => {
      try {
        deriveEarningCents({ durationMinutes: 30, hourlyRateUsd: 20.001 });
        throw new Error("did not throw");
      } catch (e) {
        expect(e).toBeInstanceOf(ConnectEarningError);
        expect((e as ConnectEarningError).reason).toBe("rate_precision_exceeded");
      }
    });
  });

  describe("fail-closed on invalid duration", () => {
    it("throws invalid_duration for 0 minutes", () => {
      try {
        deriveEarningCents({ durationMinutes: 0, hourlyRateUsd: 20 });
        throw new Error("did not throw");
      } catch (e) {
        expect((e as ConnectEarningError).reason).toBe("invalid_duration");
      }
    });

    it("throws invalid_duration for a negative duration", () => {
      try {
        deriveEarningCents({ durationMinutes: -30, hourlyRateUsd: 20 });
        throw new Error("did not throw");
      } catch (e) {
        expect((e as ConnectEarningError).reason).toBe("invalid_duration");
      }
    });

    it("throws invalid_duration for a non-integer duration (30.5)", () => {
      try {
        deriveEarningCents({ durationMinutes: 30.5, hourlyRateUsd: 20 });
        throw new Error("did not throw");
      } catch (e) {
        expect((e as ConnectEarningError).reason).toBe("invalid_duration");
      }
    });
  });

  describe("result is always a non-negative integer", () => {
    it("never returns a float", () => {
      const cents = deriveEarningCents({ durationMinutes: 37, hourlyRateUsd: 13.33 });
      expect(Number.isInteger(cents)).toBe(true);
      expect(cents).toBeGreaterThanOrEqual(0);
    });
  });
});
