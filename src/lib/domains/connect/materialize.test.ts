import { describe, it, expect } from "vitest";

import {
  materializeSessionEarning,
  MaterializeEarningError,
  AGREEMENT_PENDING_HOLD_REASON,
} from "./materialize";

// Spec 040 Slice 3a — the earnings-materialization decision, the authoritative
// agreement-gate enforcement point. Pure: no Stripe, no DB, no clock; the AMOUNT
// is injected (deriveEarningCents is the caller's concern).
//
//   FR-021: before `connect_cutover_date` the legacy payroll path owns the
//           delivery — materialize NOTHING (dormancy).
//   FR-029: accepted current version → `pending`; not accepted (grace OR
//           hard-gate) → `held`/`agreement_pending`, releasable on acceptance,
//           never voided. Grace is booking-time and does not enter here.
//   FR-030a: the current agreement version is STAMPED at materialization,
//            never timestamp-derived — for pending AND held entries alike.

const CUTOVER = new Date("2026-08-01T00:00:00Z");

function base() {
  return {
    sessionDeliveryId: "11111111-1111-1111-1111-111111111111",
    teacherId: "22222222-2222-2222-2222-222222222222",
    deliveredAt: new Date("2026-08-10T00:00:00Z"),
    earningCents: 1000,
    acceptedCurrentVersion: true,
    currentAgreementVersion: "1",
    cutoverDate: CUTOVER,
  };
}

describe("materializeSessionEarning", () => {
  describe("dormancy / cutover partition (FR-021)", () => {
    it("returns null when the cutover date is unset (Connect disabled)", () => {
      expect(materializeSessionEarning({ ...base(), cutoverDate: null })).toBeNull();
    });

    it("returns null for a delivery before the cutover date", () => {
      expect(
        materializeSessionEarning({
          ...base(),
          deliveredAt: new Date("2026-07-31T23:59:59Z"),
        }),
      ).toBeNull();
    });

    it("materializes a delivery exactly at the cutover instant (>= is inclusive)", () => {
      const entry = materializeSessionEarning({ ...base(), deliveredAt: CUTOVER });
      expect(entry).not.toBeNull();
    });
  });

  describe("agreement-gate enforcement (FR-029)", () => {
    it("accrues `pending` with no hold when the current version is accepted", () => {
      const entry = materializeSessionEarning({ ...base(), acceptedCurrentVersion: true });
      expect(entry).toMatchObject({ status: "pending", hold_reason: null });
    });

    it("accrues `held`/agreement_pending when the current version is NOT accepted", () => {
      const entry = materializeSessionEarning({ ...base(), acceptedCurrentVersion: false });
      expect(entry).toMatchObject({
        status: "held",
        hold_reason: AGREEMENT_PENDING_HOLD_REASON,
      });
    });
  });

  describe("version stamping (FR-030a)", () => {
    it("stamps the current version on a pending (accepted) entry", () => {
      const entry = materializeSessionEarning({
        ...base(),
        acceptedCurrentVersion: true,
        currentAgreementVersion: "3",
      });
      expect(entry?.agreement_version).toBe("3");
    });

    it("stamps the current version on a held (unsigned) entry too", () => {
      const entry = materializeSessionEarning({
        ...base(),
        acceptedCurrentVersion: false,
        currentAgreementVersion: "3",
      });
      expect(entry?.agreement_version).toBe("3");
    });
  });

  describe("entry shape", () => {
    it("carries the injected amount and source identity as a kind='session' row", () => {
      const entry = materializeSessionEarning(base());
      expect(entry).toEqual({
        kind: "session",
        teacher_id: "22222222-2222-2222-2222-222222222222",
        session_delivery_id: "11111111-1111-1111-1111-111111111111",
        amount_cents: 1000,
        agreement_version: "1",
        status: "pending",
        hold_reason: null,
      });
    });
  });

  describe("fail-closed input guards (money path)", () => {
    it.each([0, -100, 12.5, NaN])(
      "throws on a non-positive-integer injected amount (%p)",
      (bad) => {
        expect(() =>
          materializeSessionEarning({ ...base(), earningCents: bad }),
        ).toThrow(MaterializeEarningError);
      },
    );

    it.each(["", "   ", "\t\n"])(
      "throws when the current agreement version is blank (%j) — never stamp whitespace as evidence",
      (blank) => {
        expect(() =>
          materializeSessionEarning({ ...base(), currentAgreementVersion: blank }),
        ).toThrow(MaterializeEarningError);
      },
    );
  });
});
