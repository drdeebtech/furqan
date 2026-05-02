// Revenue split for recorded-course purchases.
//
// One pure, integer-only function so the upcoming Stripe webhook (Stage 11)
// and the existing `course_enrollments` insert path agree on the same math.
// Returns cents — never floats — to avoid drift on long-run aggregation.
//
// Inputs:
//   priceCents: int >= 0       — exact charge captured from Stripe (cents)
//   ownership: 'platform'|'teacher'
//   teacherShareBps: int 0..10000 — basis points (7000 = 70%). Always 0
//     when ownership='platform' per the courses_ownership_consistent CHECK.
//
// Output: { platformFeeCents, teacherEarningsCents } that always sum back
//   exactly to priceCents (no missing or duplicated cents).

import type { CourseOwnership } from "@/types/database";

export interface RevenueSplitInput {
  priceCents: number;
  ownership: CourseOwnership;
  teacherShareBps: number;
}

export interface RevenueSplit {
  platformFeeCents: number;
  teacherEarningsCents: number;
}

export function computeCourseRevenueSplit(
  input: RevenueSplitInput,
): RevenueSplit {
  const { priceCents, ownership, teacherShareBps } = input;

  if (priceCents < 0 || !Number.isInteger(priceCents)) {
    throw new Error("priceCents must be a non-negative integer");
  }

  if (ownership === "platform") {
    return { platformFeeCents: priceCents, teacherEarningsCents: 0 };
  }

  if (
    !Number.isInteger(teacherShareBps) ||
    teacherShareBps < 0 ||
    teacherShareBps > 10000
  ) {
    throw new Error("teacherShareBps must be an integer in [0, 10000]");
  }

  // Round teacher earnings DOWN — the teacher absorbs the sub-cent
  // remainder, the platform receives an exact `priceCents - teacherEarnings`.
  // We always derive `platformFeeCents` by subtraction (not a parallel
  // calculation) so the two outputs sum to `priceCents` exactly, guaranteed.
  // The n8n payout aggregator and any future Stripe webhook MUST use this
  // helper to stay consistent.
  const teacherEarningsCents = Math.floor((priceCents * teacherShareBps) / 10000);
  const platformFeeCents = priceCents - teacherEarningsCents;
  return { platformFeeCents, teacherEarningsCents };
}
