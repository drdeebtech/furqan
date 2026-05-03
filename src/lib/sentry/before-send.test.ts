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

  it("drops React DOM removeChild noise even when Sentry marks _next chunks as in_app:true (E4-7/E4-9/E4-B)", () => {
    // Real production payload: Sentry's heuristic flags app:///_next/static/chunks/*
    // as in_app:true because they aren't in node_modules. Path-based detection
    // is required — the prior in_app-flag check missed this entire class.
    const result = beforeSend(
      buildEvent({
        exception: {
          values: [
            {
              type: "NotFoundError",
              value: "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
              stacktrace: {
                frames: [
                  { filename: "app:///_next/static/chunks/02lf.w6xlvq8p.js", function: "lr", in_app: true },
                  { filename: "app:///_next/static/chunks/02lf.w6xlvq8p.js", function: "li", in_app: true },
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

  it("drops 'Rendered more hooks' noise even when _next chunks are flagged in_app:true (E4-A/E4-8)", () => {
    const result = beforeSend(
      buildEvent({
        message: "Rendered more hooks than during the previous render.",
        exception: {
          values: [
            {
              type: "Error",
              value: "Rendered more hooks than during the previous render.",
              stacktrace: {
                frames: [
                  { filename: "app:///_next/static/chunks/02lf.w6xlvq8p.js", function: "u", in_app: true },
                  { filename: "app:///_next/static/chunks/02lf.w6xlvq8p.js", function: "renderWithHooks", in_app: true },
                ],
              },
            },
          ],
        },
      }),
      buildHint("Rendered more hooks than during the previous render."),
    );

    expect(result).toBeNull();
  });

  it("drops Load failed on useActionState routes (/login) even with an in-app form-action frame (E4-3)", () => {
    // useActionState pages don't go through fetchServerAction, so the
    // existing marker- and framework-only checks miss network aborts
    // there. The transaction tag pins the route. Real users hitting
    // wifi blips on the login form should not page anyone.
    const result = beforeSend(
      buildEvent({
        transaction: "/login",
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Load failed",
              stacktrace: {
                frames: [
                  { filename: "app:///_next/static/chunks/0d-5~nncqvl9l.js", function: "I", in_app: true },
                  { filename: "src/app/(auth)/login/login-form.tsx", function: "handleSubmit", in_app: true },
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

  it("drops 'Rendered more hooks' on iOS 16 Mobile Safari with in-app frames (E4-A)", () => {
    // iOS 15-16 has the documented service-worker fetch-abort bug that
    // surfaces as React's hook-recovery error. Safari 17 ships the fix.
    // Since we've never seen a real hooks bug from old Safari here,
    // route-and-version match is enough to drop.
    const result = beforeSend(
      buildEvent({
        contexts: {
          os: { name: "iOS" },
          browser: { name: "Mobile Safari", version: "16.5" },
        },
        message: "Rendered more hooks than during the previous render.",
        exception: {
          values: [
            {
              type: "Error",
              value: "Rendered more hooks than during the previous render.",
              stacktrace: {
                frames: [
                  { filename: "src/components/shared/messages-view.tsx", function: "MessagesView", in_app: true },
                ],
              },
            },
          ],
        },
      }),
      buildHint("Rendered more hooks than during the previous render."),
    );

    expect(result).toBeNull();
  });

  it("keeps 'Rendered more hooks' on a modern desktop browser with in-app frames", () => {
    // Negative case: no version match, no framework-only frames — this
    // is a real hooks bug and must reach Sentry.
    const result = beforeSend(
      buildEvent({
        contexts: {
          os: { name: "macOS" },
          browser: { name: "Chrome", version: "127.0.0" },
        },
        message: "Rendered more hooks than during the previous render.",
        exception: {
          values: [
            {
              type: "Error",
              value: "Rendered more hooks than during the previous render.",
              stacktrace: {
                frames: [
                  { filename: "src/components/shared/messages-view.tsx", function: "MessagesView", in_app: true },
                ],
              },
            },
          ],
        },
      }),
      buildHint("Rendered more hooks than during the previous render."),
    );

    expect(result).not.toBeNull();
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
