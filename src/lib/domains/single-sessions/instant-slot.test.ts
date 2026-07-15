import { describe, it, expect } from "vitest";

// server-only barrier is a no-op in tests (the module under test injects its
// admin client, so it never imports secrets — but guard anyway for parity).
import { vi } from "vitest";
vi.mock("server-only", () => ({}));

import { validateInstantSlot } from "./instant-slot";

// ─── Thenable Supabase query-builder mock ─────────────────────────────────────
// Any chained method returns the same builder; awaiting it resolves to the
// per-table {data,error} the test configured. This keeps the tests at the
// behavior level — they don't assert which filter methods the impl chains.
function qb(result: { data: unknown; error: unknown }) {
  let chain: unknown;
  chain = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
        if (typeof prop === "symbol") return undefined;
        return () => chain;
      },
    },
  );
  return chain;
}

function makeAdmin(byTable: Record<string, { data: unknown; error: unknown }>) {
  return {
    from: (t: string) => qb(byTable[t] ?? { data: [], error: null }),
  } as never;
}

// A weekly slot that covers the whole day, so availability math never gates
// the tests that aren't about availability.
const ALL_DAY = { start_time: "00:00:00", end_time: "23:59:00", slot_duration: 30 };

const TEACHER = "00000000-0000-1000-8000-000000000002";
const NOW = new Date("2026-07-15T00:00:00.000Z");
const FUTURE = new Date("2026-07-22T09:00:00.000Z");
const PAST = new Date("2026-07-14T09:00:00.000Z");

describe("validateInstantSlot (spec 022 — fail-before-charge, principle 11)", () => {
  it("rejects a slot in the past without any DB lookup", async () => {
    const admin = makeAdmin({});
    const res = await validateInstantSlot(admin, {
      teacherId: TEACHER,
      scheduledAt: PAST,
      durationMin: 30,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "past" });
  });

  it("rejects when no availability slot covers the requested time", async () => {
    const admin = makeAdmin({
      teacher_availability: { data: [], error: null },
    });
    const res = await validateInstantSlot(admin, {
      teacherId: TEACHER,
      scheduledAt: FUTURE,
      durationMin: 30,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "unavailable" });
  });

  it("rejects when the date is blocked by an availability exception", async () => {
    const admin = makeAdmin({
      teacher_availability: { data: [ALL_DAY], error: null },
      availability_exceptions: {
        data: [{ is_blocked: true, start_time: null, end_time: null }],
        error: null,
      },
    });
    const res = await validateInstantSlot(admin, {
      teacherId: TEACHER,
      scheduledAt: FUTURE,
      durationMin: 30,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "blocked" });
  });

  it("rejects when an existing pending/confirmed booking overlaps", async () => {
    const admin = makeAdmin({
      teacher_availability: { data: [ALL_DAY], error: null },
      availability_exceptions: { data: [], error: null },
      bookings: {
        data: [{ scheduled_at: FUTURE.toISOString(), duration_min: 30 }],
        error: null,
      },
    });
    const res = await validateInstantSlot(admin, {
      teacherId: TEACHER,
      scheduledAt: FUTURE,
      durationMin: 30,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "overlap" });
  });

  it("accepts a future, in-availability, unblocked, non-overlapping slot", async () => {
    const admin = makeAdmin({
      teacher_availability: { data: [ALL_DAY], error: null },
      availability_exceptions: { data: [], error: null },
      bookings: { data: [], error: null },
    });
    const res = await validateInstantSlot(admin, {
      teacherId: TEACHER,
      scheduledAt: FUTURE,
      durationMin: 30,
      now: NOW,
    });
    expect(res).toEqual({ ok: true });
  });

  it("fails closed (never ok) when an availability lookup errors", async () => {
    const admin = makeAdmin({
      teacher_availability: { data: null, error: { message: "db down" } },
    });
    const res = await validateInstantSlot(admin, {
      teacherId: TEACHER,
      scheduledAt: FUTURE,
      durationMin: 30,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: "lookup_failed" });
  });
});
