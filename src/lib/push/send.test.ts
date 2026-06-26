import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  deleteEq: vi.fn(),
  logError: vi.fn(),
  selectEq: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mocks.logError(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mocks.createAdminClient(),
}));
vi.mock("./vapid", () => ({
  configuredWebpush: { sendNotification: mocks.sendNotification },
}));

import { sendPushToUser } from "./send";

function adminClient() {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: mocks.selectEq })),
      delete: vi.fn(() => ({ eq: mocks.deleteEq })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminClient.mockReturnValue(adminClient());
  mocks.deleteEq.mockResolvedValue({ error: null });
});

describe("sendPushToUser", () => {
  it("fans out the verified payload to every saved endpoint", async () => {
    mocks.selectEq.mockResolvedValue({
      data: [
        { id: "sub-1", endpoint: "https://push.test/1", keys_p256dh: "p1", keys_auth: "a1" },
        { id: "sub-2", endpoint: "https://push.test/2", keys_p256dh: "p2", keys_auth: "a2" },
      ],
      error: null,
    });
    mocks.sendNotification.mockResolvedValue({ statusCode: 201 });

    const result = await sendPushToUser("user-1", {
      title: "موعد المراجعة",
      body: "بقي ١٥ دقيقة على جلستك",
      url: "/student/bookings",
    });

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      {
        endpoint: "https://push.test/1",
        keys: { p256dh: "p1", auth: "a1" },
      },
      JSON.stringify({
        title: "موعد المراجعة",
        body: "بقي ١٥ دقيقة على جلستك",
        url: "/student/bookings",
      }),
    );
  });

  it("removes a dead endpoint after a 410 response", async () => {
    mocks.selectEq.mockResolvedValue({
      data: [
        { id: "sub-dead", endpoint: "https://push.test/dead", keys_p256dh: "p", keys_auth: "a" },
      ],
      error: null,
    });
    mocks.sendNotification.mockRejectedValue(
      Object.assign(new Error("Gone"), { statusCode: 410 }),
    );

    const result = await sendPushToUser("user-1", {
      title: "تذكير",
      body: "موعد المراجعة",
    });

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(mocks.deleteEq).toHaveBeenCalledWith("id", "sub-dead");
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("fails soft when the subscription lookup throws", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("database unavailable");
    });

    await expect(
      sendPushToUser("user-1", { title: "تذكير", body: "موعد المراجعة" }),
    ).resolves.toEqual({ sent: 0, failed: 0 });
    expect(mocks.logError).toHaveBeenCalledWith(
      "push: unexpected send failure",
      expect.any(Error),
      { tag: "push", userId: "user-1" },
    );
  });
});
