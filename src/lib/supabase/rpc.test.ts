import { describe, it, expect, vi } from "vitest";
import { callRpc } from "./rpc";

/**
 * `callRpc` is a thin, behaviour-preserving typed seam over `client.rpc()`.
 * These tests assert that it forwards the name + args verbatim and returns the
 * client's result untouched — the typing is enforced at compile time (tsc),
 * not at runtime, so the runtime contract is simply "transparent passthrough".
 */
describe("callRpc", () => {
  it("forwards the function name and typed args to client.rpc", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "progress-id-1", error: null });
    const client = { rpc };

    const result = await callRpc(client, "record_student_progress", {
      p_booking_id: "b1",
      p_progress_type: "new",
      p_surah_from: 1,
      p_ayah_from: 1,
      p_surah_to: 1,
      p_ayah_to: 7,
      p_pages_reviewed: null,
      p_quality_rating: null,
      p_level: null,
      p_teacher_notes: null,
      p_errors: null,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("record_student_progress", {
      p_booking_id: "b1",
      p_progress_type: "new",
      p_surah_from: 1,
      p_ayah_from: 1,
      p_surah_to: 1,
      p_ayah_to: 7,
      p_pages_reviewed: null,
      p_quality_rating: null,
      p_level: null,
      p_teacher_notes: null,
      p_errors: null,
    });
    expect(result).toEqual({ data: "progress-id-1", error: null });
  });

  it("returns the client error result unchanged (no false success)", async () => {
    const error = { message: "booking_not_found", code: "P0001" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    const client = { rpc };

    const result = await callRpc(client, "end_session_with_booking", {
      p_session_id: "s1",
      p_actual_duration: 30,
    });

    expect(result.error).toBe(error);
    expect(result.data).toBeNull();
  });

  it("passes no args for parameterless functions", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const client = { rpc };

    const result = await callRpc(client, "is_admin");

    expect(rpc).toHaveBeenCalledWith("is_admin", undefined);
    expect(result.data).toBe(true);
  });

  it("preserves .then()-chainability of the underlying builder", async () => {
    // The webhook handler chains `.rpc(...).then(...)`; the returned value must
    // be thenable, not an already-awaited plain object.
    const rpc = vi.fn().mockReturnValue(
      Promise.resolve({ data: [{ booking_id: "bk1" }], error: null }),
    );
    const client = { rpc };

    const mapped = await callRpc(client, "end_session_from_webhook", {
      p_session_id: "s1",
      p_ended_at: "2026-06-01T00:00:00Z",
      p_duration_min: 30,
      p_duration_seconds: 1800,
      p_event_id: "evt1",
      p_event_type: "meeting.ended",
      p_room_name: "room-1",
      p_payload_json: {},
    }).then((r) => r.data);

    expect(mapped).toEqual([{ booking_id: "bk1" }]);
  });
});
