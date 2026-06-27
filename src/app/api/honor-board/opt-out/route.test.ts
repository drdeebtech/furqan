import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  setOptOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mocks.createClient(),
}));

vi.mock("@/lib/domains/honor-board/opt-out", () => ({
  setOptOut: (...args: unknown[]) => mocks.setOptOut(...args),
}));

import { PATCH } from "./route";

const CHILD_ID = "11111111-1111-4111-8111-111111111111";

function request(body: unknown, raw?: string) {
  return new Request("http://localhost/api/honor-board/opt-out", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "session-user" } } });
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
  mocks.setOptOut.mockResolvedValue({ ok: true });
});

describe("PATCH /api/honor-board/opt-out", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await PATCH(request({ optedOut: true }))).status).toBe(401);
    expect(mocks.setOptOut).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON", async () => {
    expect((await PATCH(request(null, "not json"))).status).toBe(400);
    expect(mocks.setOptOut).not.toHaveBeenCalled();
  });

  it("returns 422 for an invalid body", async () => {
    expect((await PATCH(request({ optedOut: "yes" }))).status).toBe(422);
    expect(mocks.setOptOut).not.toHaveBeenCalled();
  });

  it("self opt-out: studentId defaults to the session user", async () => {
    const response = await PATCH(request({ optedOut: true }));
    expect(response.status).toBe(200);
    // caller AND target are the session user; identity never comes from the body.
    expect(mocks.setOptOut).toHaveBeenCalledWith("session-user", true, "session-user");
  });

  it("guardian path: target is the supplied child, caller stays the session user", async () => {
    const response = await PATCH(request({ studentId: CHILD_ID, optedOut: true }));
    expect(response.status).toBe(200);
    // setOptOut validates the guardian→child link server-side; callerUid is the
    // session user, so a forged studentId can only succeed for a real child.
    expect(mocks.setOptOut).toHaveBeenCalledWith(CHILD_ID, true, "session-user");
  });

  it("propagates a 403 when setOptOut denies the caller", async () => {
    mocks.setOptOut.mockResolvedValue({ ok: false, error: "not authorized", status: 403 });
    const response = await PATCH(request({ studentId: CHILD_ID, optedOut: true }));
    expect(response.status).toBe(403);
  });
});
