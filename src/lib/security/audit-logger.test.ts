import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockInsert = vi.fn();
const mockFrom = vi.fn(() => ({ insert: mockInsert }));
const mockCreateAdminClient = vi.fn(() => ({ from: mockFrom }));
const mockCaptureMessage = vi.fn();
const mockLogWarn = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockCreateAdminClient(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));

vi.mock("@/lib/logger", () => ({
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
}));

import { recordSecurityAlert } from "./audit-logger";

describe("recordSecurityAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  it("inserts a security_alert row and tags Sentry", async () => {
    await recordSecurityAlert({
      userId: "user-1",
      email: "ali@example.com",
      attemptedAction: "login.rate_limited",
      alertLevel: "critical",
      metadata: { route: "/login" },
    });

    expect(mockFrom).toHaveBeenCalledWith("security_alerts");
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: "user-1",
      email: "ali@example.com",
      attempted_action: "login.rate_limited",
      alert_level: "critical",
      metadata: { route: "/login" },
    });
    expect(mockCaptureMessage).toHaveBeenCalledWith("Security alert: login.rate_limited", {
      level: "fatal",
      tags: {
        security_event: "true",
        alert_level: "critical",
      },
      extra: {
        user_id: "user-1",
        attempted_action: "login.rate_limited",
        alert_level: "critical",
        metadata: { route: "/login" },
      },
    });
  });

  it("fails soft when the insert rejects", async () => {
    mockInsert.mockRejectedValue(new Error("db down"));

    await expect(
      recordSecurityAlert({
        attemptedAction: "webhook.bad_sig",
        alertLevel: "warning",
      }),
    ).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith("recordSecurityAlert failed", {
      tag: "security-alert",
      attemptedAction: "webhook.bad_sig",
      alertLevel: "warning",
      error: "db down",
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("fails soft when the insert resolves with an error", async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: "boom" } });

    await expect(
      recordSecurityAlert({
        attemptedAction: "upload.rejected",
        alertLevel: "warning",
      }),
    ).resolves.toBeUndefined();

    expect(mockLogWarn).toHaveBeenCalledWith("recordSecurityAlert failed", {
      tag: "security-alert",
      attemptedAction: "upload.rejected",
      alertLevel: "warning",
      error: "boom",
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});
