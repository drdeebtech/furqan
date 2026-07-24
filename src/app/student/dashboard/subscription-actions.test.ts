import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const {
  mockCancelPayPalSubscription,
  mockCreateAdminClient,
  mockCreateClient,
  mockIsPayPalConfigured,
  mockLogError,
  mockRequireRole,
  MockForbiddenError,
  MockUnauthenticatedError,
} = vi.hoisted(() => {
  class MockForbiddenError extends Error {}
  class MockUnauthenticatedError extends MockForbiddenError {}
  return {
    mockCancelPayPalSubscription: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockCreateClient: vi.fn(),
    mockIsPayPalConfigured: vi.fn(),
    mockLogError: vi.fn(),
    mockRequireRole: vi.fn(),
    MockForbiddenError,
    MockUnauthenticatedError,
  };
});

vi.mock("@/lib/auth/require-admin", () => ({
  ForbiddenError: MockForbiddenError,
  UnauthenticatedError: MockUnauthenticatedError,
  requireRole: mockRequireRole,
}));

vi.mock("@/lib/logger", () => ({ logError: mockLogError }));

vi.mock("@/lib/paypal/client", () => ({
  cancelPayPalSubscription: mockCancelPayPalSubscription,
  isPayPalConfigured: mockIsPayPalConfigured,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { revalidatePath } from "next/cache";
import { cancelCurrentStudentPayPalSubscription } from "./subscription-actions";

const STUDENT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_STUDENT_ID = "00000000-0000-4000-8000-000000000002";

type SubscriptionRow = {
  id: string;
  student_id: string;
  provider: string;
  provider_subscription_id: string | null;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
};

type SupabaseError = { message: string; code?: string };
type QueryMode = "select" | "update";
type QueryFilter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "in"; column: string; values: unknown[] };
type QueryOrder = { column: keyof SubscriptionRow; ascending: boolean };

interface QueryResult<T> {
  data: T | null;
  error: SupabaseError | null;
}

interface QueryTrace {
  client: "user" | "admin";
  table: string;
  mode: QueryMode;
  selectColumns: string[];
  filters: QueryFilter[];
  patch: Partial<SubscriptionRow> | null;
}

interface SubscriptionQuery {
  select(columns: string): SubscriptionQuery;
  eq(column: string, value: unknown): SubscriptionQuery;
  in(column: string, values: unknown[]): SubscriptionQuery;
  order(column: string, opts: { ascending: boolean }): SubscriptionQuery;
  limit(count: number): SubscriptionQuery;
  update(patch: Partial<SubscriptionRow>): SubscriptionQuery;
  maybeSingle<T>(): Promise<QueryResult<T>>;
}

function paypalSubscription(
  overrides: Partial<SubscriptionRow> = {},
): SubscriptionRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    student_id: STUDENT_ID,
    provider: "paypal",
    provider_subscription_id: "I-PAYPAL-123",
    status: "active",
    cancel_at_period_end: false,
    current_period_end: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

function matchesFilters(row: SubscriptionRow, filters: QueryFilter[]): boolean {
  return filters.every((filter) => {
    const value = row[filter.column as keyof SubscriptionRow];
    if (filter.kind === "eq") return value === filter.value;
    return filter.values.includes(value);
  });
}

function compareOrderedValues(
  left: SubscriptionRow[keyof SubscriptionRow],
  right: SubscriptionRow[keyof SubscriptionRow],
): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return String(left).localeCompare(String(right));
}

function buildSupabaseStub(options: {
  subscription?: SubscriptionRow | null;
  subscriptions?: SubscriptionRow[];
  readError?: SupabaseError;
  updateError?: SupabaseError;
  ignoreReadFilters?: boolean;
}) {
  const initialSubscriptions = options.subscriptions ?? (options.subscription ? [options.subscription] : []);
  const subscriptions = initialSubscriptions.map((subscription) => ({ ...subscription }));
  const traces: QueryTrace[] = [];

  function createFrom(client: "user" | "admin") {
    return function from(table: string): SubscriptionQuery {
      let mode: QueryMode = "select";
      let patch: Partial<SubscriptionRow> | null = null;
      let orderBy: QueryOrder | null = null;
      let rowLimit: number | null = null;
      const filters: QueryFilter[] = [];
      const selectColumns: string[] = [];

      const query = {} as SubscriptionQuery;
      Object.assign(query, {
        select: vi.fn((columns: string) => {
          selectColumns.push(columns);
          return query;
        }),
        eq: vi.fn((column: string, value: unknown) => {
          filters.push({ kind: "eq", column, value });
          return query;
        }),
        in: vi.fn((column: string, values: unknown[]) => {
          filters.push({ kind: "in", column, values });
          return query;
        }),
        order: vi.fn((column: string, opts: { ascending: boolean }) => {
          orderBy = { column: column as keyof SubscriptionRow, ascending: opts.ascending };
          return query;
        }),
        limit: vi.fn((count: number) => {
          rowLimit = count;
          return query;
        }),
        update: vi.fn((nextPatch: Partial<SubscriptionRow>) => {
          mode = "update";
          patch = { ...nextPatch };
          return query;
        }),
        maybeSingle: async <T,>() => {
          traces.push({
            client,
            table,
            mode,
            selectColumns: [...selectColumns],
            filters: [...filters],
            patch: patch ? { ...patch } : null,
          });
          if (table !== "subscriptions") {
            return { data: null, error: { message: `unexpected table ${table}` } } as QueryResult<T>;
          }
          if (mode === "select") {
            const matchingRows = options.ignoreReadFilters
              ? subscriptions
              : subscriptions.filter((candidate) => matchesFilters(candidate, filters));
            const order = orderBy;
            const orderedRows = order
              ? [...matchingRows].sort((left, right) => {
                  const comparison = compareOrderedValues(left[order.column], right[order.column]);
                  return order.ascending ? comparison : -comparison;
                })
              : matchingRows;
            const limitedRows = rowLimit === null ? orderedRows : orderedRows.slice(0, rowLimit);
            return {
              data: (options.readError ? null : limitedRows[0] ?? null) as T | null,
              error: options.readError ?? null,
            };
          }
          if (client === "user") {
            return { data: null, error: null } as QueryResult<T>;
          }
          if (options.updateError) {
            return { data: null, error: options.updateError } as QueryResult<T>;
          }
          const target = subscriptions.find((row) => matchesFilters(row, filters));
          if (!target || !patch) return { data: null, error: null } as QueryResult<T>;
          Object.assign(target, patch);
          return { data: { id: target.id } as T, error: null };
        },
      });
      return query;
    };
  }

  const userClient = { from: vi.fn(createFrom("user")) };
  const adminClient = { from: vi.fn(createFrom("admin")) };
  mockCreateClient.mockResolvedValue(userClient);
  mockCreateAdminClient.mockReturnValue(adminClient);
  return { adminClient, userClient, subscriptions, traces };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireRole.mockResolvedValue({ id: STUDENT_ID });
  mockIsPayPalConfigured.mockReturnValue(true);
  mockCancelPayPalSubscription.mockResolvedValue({ ok: true });
});

describe("cancelCurrentStudentPayPalSubscription", () => {
  it("cancels a PayPal subscription and marks it canceling without ending access", async () => {
    const activeSubscription = paypalSubscription({
      id: "11111111-1111-4111-8111-111111111111",
      provider_subscription_id: "I-PAYPAL-ACTIVE",
      current_period_end: "2026-08-01T00:00:00Z",
    });
    const newerCanceledSubscription = paypalSubscription({
      id: "22222222-2222-4222-8222-222222222222",
      provider_subscription_id: "I-PAYPAL-CANCELED",
      status: "canceled",
      current_period_end: "2026-09-01T00:00:00Z",
    });
    const { subscriptions, traces } = buildSupabaseStub({
      subscriptions: [newerCanceledSubscription, activeSubscription],
    });

    const result = await cancelCurrentStudentPayPalSubscription();

    expect(result).toEqual({ ok: true });
    expect(mockRequireRole).toHaveBeenCalledWith("student");
    expect(mockCancelPayPalSubscription).toHaveBeenCalledWith(
      "I-PAYPAL-ACTIVE",
      "Student requested subscription cancellation from the Furqan dashboard.",
    );
    expect(subscriptions.find((subscription) => subscription.id === activeSubscription.id)).toMatchObject({
      status: "active",
      cancel_at_period_end: true,
    });
    expect(subscriptions.find((subscription) => subscription.id === newerCanceledSubscription.id)).toMatchObject({
      status: "canceled",
      cancel_at_period_end: false,
    });
    expect(traces).toEqual([
      expect.objectContaining({
        client: "user",
        table: "subscriptions",
        mode: "select",
        filters: expect.arrayContaining([
          { kind: "eq", column: "student_id", value: STUDENT_ID },
          { kind: "eq", column: "provider", value: "paypal" },
          { kind: "eq", column: "status", value: "active" },
        ]),
      }),
      expect.objectContaining({
        client: "admin",
        table: "subscriptions",
        mode: "update",
        patch: { cancel_at_period_end: true },
        filters: expect.arrayContaining([
          { kind: "eq", column: "id", value: "11111111-1111-4111-8111-111111111111" },
          { kind: "eq", column: "provider", value: "paypal" },
          { kind: "eq", column: "status", value: "active" },
        ]),
      }),
    ]);
    expect(traces[0]?.filters).not.toContainEqual({
      kind: "in",
      column: "status",
      values: ["active", "canceled"],
    });
    expect(traces.filter((trace) => trace.mode === "update").map((trace) => trace.client)).toEqual(["admin"]);
    expect(traces[1]?.filters).not.toContainEqual({ kind: "eq", column: "student_id", value: STUDENT_ID });
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/student/dashboard");
    expect(new Set(traces.map((trace) => trace.table))).toEqual(new Set(["subscriptions"]));
  });

  it("returns forbidden when the RLS read returns another student's subscription", async () => {
    const { subscriptions } = buildSupabaseStub({
      subscription: paypalSubscription({ student_id: OTHER_STUDENT_ID }),
      ignoreReadFilters: true,
    });

    const result = await cancelCurrentStudentPayPalSubscription();

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      error: "ليس لديك صلاحية لهذا الاشتراك / You do not have permission for this subscription.",
    });
    expect(mockCancelPayPalSubscription).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(subscriptions[0]?.cancel_at_period_end).toBe(false);
  });

  it("is idempotent when the subscription is already canceling", async () => {
    const { subscriptions } = buildSupabaseStub({
      subscription: paypalSubscription({ cancel_at_period_end: true }),
    });

    const first = await cancelCurrentStudentPayPalSubscription();
    const second = await cancelCurrentStudentPayPalSubscription();

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(mockCancelPayPalSubscription).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(subscriptions[0]).toMatchObject({
      status: "active",
      cancel_at_period_end: true,
    });
  });

  it("is idempotent when no active PayPal subscription remains but a row is already canceling", async () => {
    const { subscriptions } = buildSupabaseStub({
      subscription: paypalSubscription({
        status: "past_due",
        cancel_at_period_end: true,
      }),
    });

    const result = await cancelCurrentStudentPayPalSubscription();

    expect(result).toEqual({ ok: true });
    expect(mockCancelPayPalSubscription).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(subscriptions[0]).toMatchObject({
      status: "past_due",
      cancel_at_period_end: true,
    });
  });

  it("is idempotent when the PayPal subscription is already canceled by webhook state", async () => {
    const { subscriptions } = buildSupabaseStub({
      subscription: paypalSubscription({ status: "canceled" }),
    });

    const result = await cancelCurrentStudentPayPalSubscription();

    expect(result).toEqual({ ok: true });
    expect(mockCancelPayPalSubscription).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(subscriptions[0]).toMatchObject({
      status: "canceled",
      cancel_at_period_end: false,
    });
  });

  it("does not update local state when PayPal cancellation fails", async () => {
    const { subscriptions } = buildSupabaseStub({
      subscription: paypalSubscription(),
    });
    mockCancelPayPalSubscription.mockRejectedValueOnce(new Error("paypal unavailable"));

    const result = await cancelCurrentStudentPayPalSubscription();

    expect(result).toEqual({
      ok: false,
      code: "retryable",
      error: "تعذر إلغاء الاشتراك الآن — حاول مرة أخرى / We could not cancel right now. Please try again.",
    });
    expect(subscriptions[0]).toMatchObject({
      status: "active",
      cancel_at_period_end: false,
    });
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns retryable when the admin local update fails after PayPal succeeds", async () => {
    const { subscriptions, traces } = buildSupabaseStub({
      subscription: paypalSubscription(),
      updateError: { message: "database unavailable" },
    });

    const result = await cancelCurrentStudentPayPalSubscription();

    expect(result).toEqual({
      ok: false,
      code: "retryable",
      error: "تعذر إلغاء الاشتراك الآن — حاول مرة أخرى / We could not cancel right now. Please try again.",
    });
    expect(mockCancelPayPalSubscription).toHaveBeenCalledWith(
      "I-PAYPAL-123",
      "Student requested subscription cancellation from the Furqan dashboard.",
    );
    expect(traces.filter((trace) => trace.mode === "update").map((trace) => trace.client)).toEqual(["admin"]);
    expect(subscriptions[0]).toMatchObject({
      status: "active",
      cancel_at_period_end: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
