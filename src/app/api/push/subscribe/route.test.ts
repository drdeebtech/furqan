import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  deleteEndpointEq: vi.fn(),
  deleteOwnerEq: vi.fn(),
  getUser: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mocks.createClient(),
}));

import { POST } from "./route";

function supabaseClient() {
  return {
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => ({
      delete: vi.fn(() => ({ eq: mocks.deleteEndpointEq })),
      upsert: mocks.upsert,
    })),
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "test-browser" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReturnValue(supabaseClient());
  mocks.getUser.mockResolvedValue({ data: { user: { id: "session-user" } } });
  mocks.deleteEndpointEq.mockReturnValue({ eq: mocks.deleteOwnerEq });
  mocks.deleteOwnerEq.mockResolvedValue({ error: null });
  mocks.upsert.mockResolvedValue({ error: null });
});

describe("POST /api/push/subscribe", () => {
  it("requires an authenticated session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    expect((await POST(request({}))).status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects malformed subscription JSON", async () => {
    expect((await POST(request({ endpoint: "not-a-url", keys: {} }))).status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("always writes the session user id, never a body-supplied id", async () => {
    const response = await POST(
      request({
        userId: "attacker-controlled",
        endpoint: "https://push.test/subscription",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteOwnerEq).toHaveBeenCalledWith("user_id", "session-user");
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://push.test/subscription",
        user_id: "session-user",
        user_agent: "test-browser",
      }),
      { onConflict: "endpoint" },
    );
  });
});
