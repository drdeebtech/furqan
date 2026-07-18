import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Spec 040 FR-029 — static wiring guard for the Teacher Agreement gate at the
 * booking entry points that are impractical to fully mock (addStudentToSession,
 * enrollInOffering, createConstrainedBooking).
 *
 * The gate logic itself is unit-tested in
 * `src/lib/domains/booking/agreement-gate.test.ts`; `createBooking`'s wiring is
 * covered functionally in `booking/__tests__/actions.test.ts`. These entry
 * points build a confirmed / debited booking through heavy multi-read admin
 * flows, so — following this repo's established static-source-guard pattern
 * (`class-offerings-rls-guard.test.ts`, `no-debit-invariant.test.ts`) — we lock
 * the two invariants that actually matter: the gate is consulted for the
 * SERVER-RESOLVED teacher (no IDOR drift), and it runs BEFORE any package debit
 * / booking insert (fail-closed ordering).
 */
const cases = [
  {
    file: "src/lib/actions/group-session.ts",
    scopeStart: "handler: async ({ sessionId, studentId }",
    gateCall: "teacherAgreementOk(admin, primary.teacher_id)",
    hasDebit: true,
  },
  {
    file: "src/lib/actions/class-offerings.ts",
    scopeStart: "export async function enrollInOffering",
    gateCall: "teacherAgreementOk(admin, offering.teacher_id)",
    hasDebit: true,
  },
  {
    // 4th path (folded in per owner decision): student self-books a 1:1 slot
    // with their assigned teacher. Debit is deferred to the confirm kernel
    // (confirm_booking_with_session), so there is no debitPackage() here —
    // only the insert-ordering invariant applies.
    file: "src/lib/domains/scheduling/bookings.ts",
    scopeStart: "export async function createConstrainedBooking",
    gateCall: "teacherAgreementOk(admin, slot.teacher_id)",
    hasDebit: false,
  },
];

describe("agreement gate wiring (booking entry points)", () => {
  for (const { file, scopeStart, gateCall, hasDebit } of cases) {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    const scope = src.slice(src.indexOf(scopeStart));

    it(`${file}: consults the gate with the server-resolved teacher id`, () => {
      expect(
        scope.includes(gateCall),
        `expected "${gateCall}" in ${file} — IDOR risk if the gate checks a different teacher than the booking targets`,
      ).toBe(true);
    });

    it(`${file}: gate runs before the booking insert${hasDebit ? " and package debit" : ""} (fail-closed)`, () => {
      const gateAt = scope.indexOf(gateCall);
      const insertAt = scope.indexOf(".insert(");
      expect(gateAt, "gate call not found in function scope").toBeGreaterThan(-1);
      expect(insertAt, "booking .insert() not found — update this guard if renamed").toBeGreaterThan(-1);
      expect(gateAt).toBeLessThan(insertAt);

      if (hasDebit) {
        const debitAt = scope.indexOf("debitPackage(");
        expect(debitAt, "debitPackage() not found — update this guard if renamed").toBeGreaterThan(-1);
        expect(gateAt).toBeLessThan(debitAt);
      }
    });
  }
});
