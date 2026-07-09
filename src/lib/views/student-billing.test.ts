/**
 * Unit tests for `studentBillingView` — the `/student/billing` read seam.
 *
 * Pre-test verification (per common/testing.md):
 *  - Pure async read bundle, no side effects. No OAuth/HMAC.
 *  - The read is RLS-scoped in production; here we inject a fake client and
 *    assert the query is built correctly (owner filter, desc order, limit) and
 *    that the snake→camel mapping + fail-soft behavior are correct.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// load-or-fail pulls in the logger (server-only transitively) — stub it.
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { studentBillingView, PAYMENTS_HISTORY_LIMIT } from "./student-billing";
import type { ServerClient } from "@/lib/supabase/types";

const STUDENT_ID = "00000000-0000-1000-8000-000000000001";

interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** Chainable fake matching `from().select().eq().order().limit()` → thenable. */
function makeClient(result: QueryResult) {
  const calls: Record<string, unknown[]> = {};
  const builder = {
    from(table: string) {
      calls.from = [table];
      return builder;
    },
    select(sel: string) {
      calls.select = [sel];
      return builder;
    },
    eq(col: string, val: unknown) {
      calls.eq = [col, val];
      return builder;
    },
    order(col: string, opts: unknown) {
      calls.order = [col, opts];
      return builder;
    },
    limit(n: number) {
      calls.limit = [n];
      return builder;
    },
    // Thenable: `await <builder>` resolves to the preset result.
    then(resolve: (v: QueryResult) => void) {
      resolve(result);
    },
  };
  return { client: builder as unknown as ServerClient, calls };
}

const ROW = {
  id: "pay_1",
  amount_usd: 12.5,
  amount_local: 600,
  local_currency: "EGP",
  status: "succeeded",
  provider: "stripe",
  created_at: "2026-07-01T10:00:00.000Z",
  paid_at: "2026-07-01T10:00:05.000Z",
  stripe_payment_intent: "pi_abc",
  booking_id: null,
};

beforeEach(() => vi.clearAllMocks());

describe("studentBillingView", () => {
  it("returns owner-scoped rows mapped to camelCase, newest first", async () => {
    const { client, calls } = makeClient({ data: [ROW], error: null });

    const { data, anyFailed } = await studentBillingView(client, STUDENT_ID);

    expect(anyFailed).toBe(false);
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({
      id: "pay_1",
      amountUsd: 12.5,
      amountLocal: 600,
      localCurrency: "EGP",
      status: "succeeded",
      provider: "stripe",
      createdAt: "2026-07-01T10:00:00.000Z",
      paidAt: "2026-07-01T10:00:05.000Z",
      stripePaymentIntent: "pi_abc",
      bookingId: null,
    });

    // Query intent: scoped to the student, newest first, bounded.
    expect(calls.from).toEqual(["payments"]);
    expect(calls.eq).toEqual(["student_id", STUDENT_ID]);
    expect(calls.order).toEqual(["created_at", { ascending: false }]);
    expect(calls.limit).toEqual([PAYMENTS_HISTORY_LIMIT]);
  });

  it("fails soft: on a query error returns [] and anyFailed=true", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    const { data, anyFailed } = await studentBillingView(client, STUDENT_ID);

    expect(data).toEqual([]);
    expect(anyFailed).toBe(true);
  });

  it("returns [] with anyFailed=false when the student has no payments", async () => {
    const { client } = makeClient({ data: [], error: null });

    const { data, anyFailed } = await studentBillingView(client, STUDENT_ID);

    expect(data).toEqual([]);
    expect(anyFailed).toBe(false);
  });
});
