import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendPushToUser = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/push/send", () => ({
  sendPushToUser: (...args: unknown[]) => mockSendPushToUser(...args),
}));

import { POST } from "./route";

function request(body: unknown, authorization?: string) {
  return new Request("http://localhost/api/push/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  mockSendPushToUser.mockResolvedValue({ sent: 1, failed: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/push/send", () => {
  it("fails closed when the cron secret is missing or mismatched", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(request({}))).status).toBe(401);

    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect((await POST(request({}, "Bearer wrong-secret"))).status).toBe(401);
    expect(mockSendPushToUser).not.toHaveBeenCalled();
  });

  it("rejects invalid fan-out input", async () => {
    const response = await POST(
      request({ userId: "not-a-uuid", title: "", body: "" }, "Bearer cron-secret"),
    );

    expect(response.status).toBe(400);
    expect(mockSendPushToUser).not.toHaveBeenCalled();
  });

  it("fans out a validated payload", async () => {
    const payload = {
      userId: "8c81e91c-16c1-4e90-a694-0457bbaad9cd",
      title: "موعد المراجعة",
      body: "بقي ١٥ دقيقة على جلستك",
      url: "/student/bookings",
      tag: "booking-reminder",
    };
    const response = await POST(request(payload, "Bearer cron-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sent: 1, failed: 0 });
    expect(mockSendPushToUser).toHaveBeenCalledWith(payload.userId, {
      title: payload.title,
      body: payload.body,
      url: payload.url,
      tag: payload.tag,
    });
  });
});
