import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockRequireAdmin = vi.fn();
const mockSendSessionNarrative = vi.fn();

vi.mock("@/lib/auth/require-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/require-admin")>();
  return {
    ...actual,
    requireAdmin: () => mockRequireAdmin(),
  };
});

vi.mock("@/lib/reports/send-narrative", () => ({
  sendSessionNarrative: (...args: unknown[]) => mockSendSessionNarrative(...args),
}));

import { ForbiddenError } from "@/lib/auth/require-admin";
import { sendSessionReport } from "./actions";

const SESSION_ID = "3f0a2b1c-9d4e-4f6a-8b7c-1d2e3f4a5b6c";

describe("sendSessionReport (issue #689 — gated wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies a non-admin caller without touching the send helper", async () => {
    mockRequireAdmin.mockRejectedValue(new ForbiddenError());

    const result = await sendSessionReport(SESSION_ID);

    expect(result.ok).toBe(false);
    expect(mockSendSessionNarrative).not.toHaveBeenCalled();
  });

  it("derives the actor from the session, never from client input", async () => {
    mockRequireAdmin.mockResolvedValue({ id: "admin-from-session" });
    mockSendSessionNarrative.mockResolvedValue({ ok: true });

    const result = await sendSessionReport(SESSION_ID);

    expect(result.ok).toBe(true);
    expect(mockSendSessionNarrative).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      actorId: "admin-from-session",
    });
  });

  it("rejects a malformed session id before any side effect", async () => {
    mockRequireAdmin.mockResolvedValue({ id: "admin-from-session" });

    const result = await sendSessionReport("not-a-uuid");

    expect(result.ok).toBe(false);
    expect(mockSendSessionNarrative).not.toHaveBeenCalled();
  });
});
