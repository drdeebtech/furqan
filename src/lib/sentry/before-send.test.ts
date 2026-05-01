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

  it("drops Load failed server-action noise when beforeSend only sees the raw client chunk frame", () => {
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
                    filename: "app:///_next/static/chunks/0d-5~nncqvl9l.js",
                    function: "I",
                    in_app: true,
                  },
                ],
              },
              // rawStacktrace is a real Sentry runtime field (pre-symbolication
              // stack with raw context lines) but isn't in the public Exception
              // type, so cast through unknown.
              ...({
                rawStacktrace: {
                  frames: [
                    {
                      filename: "app:///_next/static/chunks/0d-5~nncqvl9l.js",
                      function: "I",
                      context: [
                        [1, "{snip} let A=await fetch(e.canonicalUrl,{method:\"POST\",headers:T,body:v});if(\"1\"===A.headers.get(u.NEXT_ACTION_NOT_FOUND_HEADER)) {snip}"],
                      ],
                    },
                  ],
                },
              } as unknown as Record<string, unknown>),
            },
          ],
        },
      }),
      {} as EventHint,
    );

    expect(result).toBeNull();
  });

  it("drops Load failed server-action noise when Sentry truncates the raw NEXT_ACTION marker", () => {
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
                    filename: "app:///_next/static/chunks/0d-5~nncqvl9l.js",
                    function: "I",
                    in_app: true,
                  },
                ],
              },
              ...({
                rawStacktrace: {
                  frames: [
                    {
                      filename: "app:///_next/static/chunks/0d-5~nncqvl9l.js",
                      function: "I",
                      context: [
                        [1, "{snip} x-deployment-id\"]=O),t&&(T[u.NEXT_URL]=t);let A=await fetch(e.canonicalUrl,{method:\"POST\",headers:T,body:v});if(\"1\"===A.headers.get(u.NEXT_A {snip}"],
                      ],
                    },
                  ],
                },
              } as unknown as Record<string, unknown>),
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

  it("drops React DOM removeChild noise from external DOM mutation (auto-translate, JAVASCRIPT-NEXTJS-E4-6)", () => {
    const result = beforeSend(
      buildEvent({
        exception: {
          values: [
            {
              type: "NotFoundError",
              value: "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
              stacktrace: {
                frames: [
                  { filename: "app:///_next/static/chunks/02lf.w6xlvq8p.js", function: "lr", in_app: false },
                  { filename: "app:///_next/static/chunks/02lf.w6xlvq8p.js", function: "li", in_app: false },
                ],
              },
            },
          ],
        },
      }),
      buildHint(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        "NotFoundError",
      ),
    );

    expect(result).toBeNull();
  });

  it("keeps NotFoundError when the stack has at least one in-app frame", () => {
    const result = beforeSend(
      buildEvent({
        exception: {
          values: [
            {
              type: "NotFoundError",
              value: "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
              stacktrace: {
                frames: [
                  { filename: "app:///_next/static/chunks/02lf.w6xlvq8p.js", function: "lr", in_app: false },
                  { filename: "src/app/student/bookings/new/booking-form.tsx", function: "handleSubmit", in_app: true },
                ],
              },
            },
          ],
        },
      }),
      buildHint(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        "NotFoundError",
      ),
    );

    expect(result).not.toBeNull();
  });
});
