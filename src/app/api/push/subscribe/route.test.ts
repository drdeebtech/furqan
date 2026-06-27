import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  adminDeleteEq: vi.fn(),
  getUser: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mocks.createClient(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mocks.createAdminClient(),
}));

import { POST } from "./route";

function supabaseClient() {
  return {
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => ({
      insert: mocks.insert,
    })),
  };
}

function adminClient() {
  return {
    from: vi.fn(() => ({
      delete: vi.fn(() => ({ eq: mocks.adminDeleteEq })),
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
  mocks.createAdminClient.mockReturnValue(adminClient());
  mocks.getUser.mockResolvedValue({ data: { user: { id: "session-user" } } });
  mocks.adminDeleteEq.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
});

describe("POST /api/push/subscribe", () => {
  it("requires an authenticated session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    expect((await POST(request({}))).status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects malformed subscription JSON", async () => {
    expect((await POST(request({ endpoint: "not-a-url", keys: {} }))).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("rejects a non-https endpoint", async () => {
    expect(
      (
        await POST(
          request({
            endpoint: "http://push.test/insecure",
            keys: { p256dh: "p", auth: "a" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
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
    expect(mocks.adminDeleteEq).toHaveBeenCalledWith(
      "endpoint",
      "https://push.test/subscription",
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://push.test/subscription",
        user_id: "session-user",
        user_agent: "test-browser",
      }),
    );
  });

  it("transfers endpoint ownership when a different account reuses the browser", async () => {
    // A stale row for this endpoint is owned by another user (shared device).
    // The route clears the endpoint via the admin client (regardless of owner)
    // and re-inserts under the current session user — not preserving the old
    // binding and not hitting the RLS-blocked update path.
    const response = await POST(
      request({
        endpoint: "https://push.test/shared-browser",
        keys: { p256dh: "new-p", auth: "new-a" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.adminDeleteEq).toHaveBeenCalledWith(
      "endpoint",
      "https://push.test/shared-browser",
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://push.test/shared-browser",
        user_id: "session-user",
        keys_p256dh: "new-p",
        keys_auth: "new-a",
      }),
    );
  });
});
