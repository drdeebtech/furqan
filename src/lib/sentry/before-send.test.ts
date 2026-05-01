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

  it("drops Load failed server-action noise when Sentry leaves event.message empty", () => {
    const result = beforeSend(
      buildEvent({
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Load failed",
              stacktrace: {
                frames: [
                  {
                    filename: "node_modules/next/src/client/components/router-reducer/reducers/server-action-reducer.ts",
                    function: "fetchServerAction",
                    in_app: false,
                  },
                  {
                    filename: "app:///_next/static/chunks/0h3xur75.rtxw.js",
                    function: undefined,
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      }),
      {} as EventHint,
    );

    expect(result).toBeNull();
  });

  it("drops production aborted errors with only node:_http_server frames", () => {
    const result = beforeSend(
      buildEvent({
        server_name: "api.furqan.today",
        contexts: { os: { name: "Linux" } },
        tags: { turbopack: "False" },
      }),
      buildHint("aborted"),
    );

    expect(result).toBeNull();
  });

  it("keeps aborted errors that have at least one in-app frame", () => {
    const result = beforeSend(
      buildEvent({
        exception: {
          values: [
            {
              type: "Error",
              value: "aborted",
              stacktrace: {
                frames: [
                  { filename: "node:_http_server", function: "abortIncoming", in_app: false },
                  { filename: "src/app/api/upload/route.ts", function: "POST", in_app: true },
                ],
              },
            },
          ],
        },
      }),
      buildHint("aborted"),
    );

    expect(result).not.toBeNull();
  });
});
