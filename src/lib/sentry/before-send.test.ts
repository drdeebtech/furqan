import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { beforeSend } from "@/lib/sentry/before-send";

function buildHint(message: string, name = "Error"): EventHint {
  return {
    originalException: {
      name,
      message,
    },
  } as EventHint;
}

function buildEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    message: "",
    exception: {
      values: [
        {
          type: "Error",
          value: "aborted",
          stacktrace: {
            frames: [
              { filename: "node:_http_server", function: "socketOnClose", in_app: false },
              { filename: "node:_http_server", function: "abortIncoming", in_app: false },
            ],
          },
        },
      ],
    },
    server_name: "Mohameds-MacBook-Air.local",
    contexts: {
      os: { name: "macOS" },
    },
    tags: {
      turbopack: "True",
    },
    ...overrides,
  } as ErrorEvent;
}

describe("beforeSend", () => {
  it("drops local turbopack abortIncoming noise", () => {
    const result = beforeSend(buildEvent(), buildHint("aborted"));
    expect(result).toBeNull();
  });

  it("keeps aborted errors when they are not the known local turbopack signature", () => {
    const result = beforeSend(
      buildEvent({
        server_name: "api.furqan.today",
        contexts: { os: { name: "Linux" } },
        tags: { turbopack: "False" },
      }),
      buildHint("aborted"),
    );

    expect(result).not.toBeNull();
  });
});
