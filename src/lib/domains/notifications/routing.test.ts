import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/dispatcher", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

import {
  resolveChannels,
  buildNotificationContent,
  sanitizeHeaderField,
  routeInAppNotification,
  type NotificationTrigger,
} from "./routing";
import { notify } from "@/lib/notifications/dispatcher";
import { getSetting } from "@/lib/settings";

const mockNotify = vi.mocked(notify);
const mockGetSetting = vi.mocked(getSetting);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSetting.mockResolvedValue(null); // default: no overrides
});

const ALL_TRIGGERS: NotificationTrigger[] = [
  "subscription.past_due",
  "subscription.expiring",
  "absence.outcome",
  "monthly_report.ready",
  "certificate.earned",
];

describe("resolveChannels", () => {
  it("returns default channels for subscription.past_due (in_app, email, whatsapp)", async () => {
    const ch = await resolveChannels("subscription.past_due");
    expect(ch).toContain("in_app");
    expect(ch).toContain("email");
    expect(ch).toContain("whatsapp");
  });

  it("drops whatsapp when notifications_whatsapp_enabled=false", async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === "notifications_whatsapp_enabled") return Promise.resolve("false");
      return Promise.resolve(null);
    });
    const ch = await resolveChannels("subscription.past_due");
    expect(ch).not.toContain("whatsapp");
    expect(ch).toContain("in_app");
  });

  it("applies platform_settings override when valid JSON matrix provided", async () => {
    const matrix = JSON.stringify({ "subscription.past_due": ["in_app"] });
    mockGetSetting.mockImplementation((key: string) => {
      if (key === "notification_channel_matrix") return Promise.resolve(matrix);
      return Promise.resolve(null);
    });
    const ch = await resolveChannels("subscription.past_due");
    expect(ch).toEqual(["in_app"]);
  });

  it("falls back to defaults when matrix JSON is invalid", async () => {
    mockGetSetting.mockImplementation((key: string) => {
      if (key === "notification_channel_matrix") return Promise.resolve("not-valid-json{{{");
      return Promise.resolve(null);
    });
    const ch = await resolveChannels("subscription.past_due");
    expect(ch).toContain("in_app");
  });
});

describe("buildNotificationContent", () => {
  it.each(ALL_TRIGGERS)("returns non-empty titleAr and titleEn for %s", (trigger) => {
    const content = buildNotificationContent(trigger, {});
    expect(content.titleAr.length).toBeGreaterThan(0);
    expect(content.titleEn.length).toBeGreaterThan(0);
    expect(content.bodyAr.length).toBeGreaterThan(0);
    expect(content.bodyEn.length).toBeGreaterThan(0);
  });
});

describe("sanitizeHeaderField", () => {
  it("strips carriage return from header values (FR-016)", () => {
    expect(sanitizeHeaderField("hello\rworld")).toBe("hello world");
  });

  it("strips newline from header values (FR-016)", () => {
    expect(sanitizeHeaderField("hello\nworld")).toBe("hello world");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeHeaderField("  hello  ")).toBe("hello");
  });

  it("handles empty string without throwing", () => {
    expect(sanitizeHeaderField("")).toBe("");
  });
});

describe("routeInAppNotification", () => {
  it("calls notify() when in_app is in the resolved channels", async () => {
    const result = await routeInAppNotification({
      recipientId: "user-1",
      trigger: "certificate.earned",
      subjectKey: "cert:user-1:appreciation_level:78",
    });
    expect(mockNotify).toHaveBeenCalledOnce();
    expect(result.channels).toContain("in_app");
  });

  it("does not call notify() when channels do not include in_app", async () => {
    const matrix = JSON.stringify({ "certificate.earned": ["email"] });
    mockGetSetting.mockImplementation((key: string) => {
      if (key === "notification_channel_matrix") return Promise.resolve(matrix);
      return Promise.resolve(null);
    });
    await routeInAppNotification({
      recipientId: "user-1",
      trigger: "certificate.earned",
      subjectKey: "cert:user-1:appreciation_level:78",
    });
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
