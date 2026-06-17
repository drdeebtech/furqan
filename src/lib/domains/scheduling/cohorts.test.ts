import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/automation/emit", () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

import { joinHalaqa, EntryConditionError } from "./cohorts";

describe("joinHalaqa", () => {
  const mockSupabase = {} as any;

  const mockAdmin = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    rpc: vi.fn(),
  } as any;

  const userId = "student-123";
  const classOfferingId = "offering-456";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should join a halaqa successfully when not full", async () => {
    mockAdmin.single.mockResolvedValueOnce({
      data: { id: classOfferingId, capacity: 5, current_enrollment: 2, status: "open", session_type: "halaqa" },
      error: null,
    });

    mockAdmin.maybeSingle.mockResolvedValueOnce({
      data: { id: "session-789" },
      error: null,
    });

    mockAdmin.single.mockResolvedValueOnce({
      data: { id: "membership-001" },
      error: null,
    });

    mockAdmin.rpc.mockResolvedValueOnce({ error: null });

    const result = await joinHalaqa(mockSupabase, mockAdmin, userId, classOfferingId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.classOfferingId).toBe(classOfferingId);
      expect(result.overflowRedirected).toBe(false);
    }
    expect(mockAdmin.insert).toHaveBeenCalled();
    expect(mockAdmin.rpc).toHaveBeenCalledWith("increment_enrollment", { p_offering_id: classOfferingId });
  });

  it("should redirect to overflow when halaqa is full", async () => {
    mockAdmin.single.mockResolvedValueOnce({
      data: { id: classOfferingId, capacity: 5, current_enrollment: 5, status: "open", session_type: "halaqa" },
      error: null,
    });

    mockAdmin.rpc.mockResolvedValueOnce({
      data: [{ halaqa_id: "overflow-789", was_created: true }],
      error: null,
    });

    mockAdmin.maybeSingle.mockResolvedValueOnce({
      data: { id: "session-overflow" },
      error: null,
    });

    mockAdmin.single.mockResolvedValueOnce({
      data: { id: "membership-002" },
      error: null,
    });

    mockAdmin.rpc.mockResolvedValueOnce({ error: null });

    const result = await joinHalaqa(mockSupabase, mockAdmin, userId, classOfferingId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.classOfferingId).toBe("overflow-789");
      expect(result.overflowRedirected).toBe(true);
    }
  });

  it("should enforce entry conditions for courses", async () => {
    mockAdmin.single.mockResolvedValueOnce({
      data: { 
        id: classOfferingId, 
        capacity: 5, 
        current_enrollment: 2, 
        status: "open", 
        session_type: "course",
        entry_conditions_json: { required_confirmation: true, prompt: "Accept terms" }
      },
      error: null,
    });

    try {
      await joinHalaqa(mockSupabase, mockAdmin, userId, classOfferingId);
      expect.fail("Should have thrown EntryConditionError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(EntryConditionError);
      expect(err.unmetCondition).toBe("Accept terms");
    }
  });
});
