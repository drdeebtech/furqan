import { describe, it, expect } from "vitest";
import { serializePayload, type EventPayload } from "./payload";

const FIXED_PAYLOAD: EventPayload = {
  event: "booking.confirmed",
  occurred_at: "2026-04-28T05:00:00.000Z",
  entity_type: "booking",
  entity_id: "11111111-2222-3333-4444-555555555555",
  actor_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  trace_id: "ffffffff-0000-1111-2222-333333333333",
  source: "furqan-app",
  data: { student_id: "s-1", teacher_id: "t-1", session_count: 4 },
};

describe("serializePayload", () => {
  it("produces identical bytes for the same logical payload across calls", () => {
    expect(serializePayload(FIXED_PAYLOAD)).toBe(serializePayload(FIXED_PAYLOAD));
  });

  it("sorts data keys alphabetically (so insertion order doesn't matter)", () => {
    const reordered: EventPayload = {
      ...FIXED_PAYLOAD,
      // keys in a different insertion order than FIXED_PAYLOAD.data
      data: { teacher_id: "t-1", session_count: 4, student_id: "s-1" },
    };
    expect(serializePayload(reordered)).toBe(serializePayload(FIXED_PAYLOAD));
  });

  it("emits top-level fields in the pinned order (event first, data last)", () => {
    const json = serializePayload(FIXED_PAYLOAD);
    const eventIdx = json.indexOf('"event"');
    const dataIdx = json.indexOf('"data"');
    expect(eventIdx).toBeGreaterThanOrEqual(0);
    expect(dataIdx).toBeGreaterThan(eventIdx);
  });

  it("changes output when a data value changes", () => {
    const tweaked: EventPayload = {
      ...FIXED_PAYLOAD,
      data: { ...FIXED_PAYLOAD.data, session_count: 5 },
    };
    expect(serializePayload(tweaked)).not.toBe(serializePayload(FIXED_PAYLOAD));
  });

  it("handles empty data object", () => {
    const empty: EventPayload = { ...FIXED_PAYLOAD, data: {} };
    const out = serializePayload(empty);
    expect(out).toContain('"data":{}');
  });

  it("preserves nested objects without reordering them (top-level data sort only)", () => {
    // Document current contract: only the immediate `data` keys are sorted.
    // Nested objects keep their insertion order. If a future change sorts
    // recursively, this test will fail and the n8n verifier must mirror it.
    const nested: EventPayload = {
      ...FIXED_PAYLOAD,
      data: { meta: { z: 1, a: 2 } },
    };
    const out = serializePayload(nested);
    expect(out).toContain('"meta":{"z":1,"a":2}');
  });
});
