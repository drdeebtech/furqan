import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  deleteEndpointEq: vi.fn(),
  deleteOwnerEq: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mocks.createClient(),
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "session-user" } } });
  mocks.deleteEndpointEq.mockReturnValue({ eq: mocks.deleteOwnerEq });
  mocks.deleteOwnerEq.mockResolvedValue({ error: null });
  mocks.createClient.mockReturnValue({
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => ({
      delete: vi.fn(() => ({ eq: mocks.deleteEndpointEq })),
    })),
  });
});

describe("POST /api/push/unsubscribe", () => {
  it("requires an authenticated session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    expect((await POST(request({ endpoint: "https://push.test/subscription" }))).status).toBe(401);
    expect(mocks.deleteEndpointEq).not.toHaveBeenCalled();
  });

  it("deletes only the authenticated user's endpoint", async () => {
    const response = await POST(
      request({ endpoint: "https://push.test/subscription", userId: "attacker-controlled" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteEndpointEq).toHaveBeenCalledWith(
      "endpoint",
      "https://push.test/subscription",
    );
    expect(mocks.deleteOwnerEq).toHaveBeenCalledWith("user_id", "session-user");
  });
});
