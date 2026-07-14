import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { canReadStudent } from "./can-read-student";

type TableName = "profiles" | "guardian_children" | "bookings";
type QueryError = { message: string };
type QueryResult = { data: unknown; error: QueryError | null };

function createSupabaseStub(results: Partial<Record<TableName, QueryResult>>) {
  const calls: { table: string; filters: Array<[string, unknown]>; inFilters: Array<[string, unknown[]]> }[] = [];

  return {
    calls,
    client: {
      from(table: TableName) {
        const call = { table, filters: [] as Array<[string, unknown]>, inFilters: [] as Array<[string, unknown[]]> };
        calls.push(call);
        const builder = {
          select() {
            return builder;
          },
          eq(column: string, value: unknown) {
            call.filters.push([column, value]);
            return builder;
          },
          in(column: string, values: unknown[]) {
            call.inFilters.push([column, values]);
            return builder;
          },
          limit() {
            return builder;
          },
          async maybeSingle() {
            return results[table] ?? { data: null, error: null };
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient<Database>,
  };
}

describe("canReadStudent", () => {
  it("allows self-access without querying", async () => {
    const supabase = createSupabaseStub({});

    await expect(canReadStudent(supabase.client, "user-1", "user-1")).resolves.toBe(true);
    expect(supabase.calls).toEqual([]);
  });

  it("allows admin role", async () => {
    const supabase = createSupabaseStub({
      profiles: { data: { role: "admin" }, error: null },
    });

    await expect(canReadStudent(supabase.client, "admin-1", "student-1")).resolves.toBe(true);
  });

  it("allows a linked guardian", async () => {
    const supabase = createSupabaseStub({
      profiles: { data: { role: "guardian" }, error: null },
      guardian_children: { data: { guardian_id: "guardian-1" }, error: null },
    });

    await expect(canReadStudent(supabase.client, "guardian-1", "student-1")).resolves.toBe(true);
  });

  it("allows an active teacher booking", async () => {
    const supabase = createSupabaseStub({
      profiles: { data: { role: "teacher" }, error: null },
      guardian_children: { data: null, error: null },
      bookings: { data: { id: "booking-1" }, error: null },
    });

    await expect(canReadStudent(supabase.client, "teacher-1", "student-1")).resolves.toBe(true);
    expect(supabase.calls.at(-1)?.inFilters).toEqual([["status", ["confirmed", "completed"]]]);
  });

  it("denies when no relationship matches", async () => {
    const supabase = createSupabaseStub({
      profiles: { data: { role: "teacher" }, error: null },
      guardian_children: { data: null, error: null },
      bookings: { data: null, error: null },
    });

    await expect(canReadStudent(supabase.client, "teacher-1", "student-1")).resolves.toBe(false);
  });

  it("denies a cancelled-only booking", async () => {
    const supabase = createSupabaseStub({
      profiles: { data: { role: "teacher" }, error: null },
      guardian_children: { data: null, error: null },
      bookings: { data: null, error: null },
    });

    await expect(canReadStudent(supabase.client, "teacher-1", "student-1")).resolves.toBe(false);
    expect(supabase.calls.at(-1)?.inFilters).toEqual([["status", ["confirmed", "completed"]]]);
  });

  it("fails closed on profile, guardian, or teacher lookup errors", async () => {
    for (const results of [
      { profiles: { data: null, error: { message: "profile boom" } } },
      {
        profiles: { data: { role: "guardian" }, error: null },
        guardian_children: { data: null, error: { message: "guardian boom" } },
      },
      {
        profiles: { data: { role: "teacher" }, error: null },
        guardian_children: { data: null, error: null },
        bookings: { data: null, error: { message: "booking boom" } },
      },
    ] satisfies Array<Partial<Record<TableName, QueryResult>>>) {
      const supabase = createSupabaseStub(results);

      await expect(canReadStudent(supabase.client, "viewer-1", "student-1")).resolves.toBe(false);
    }
  });
});
