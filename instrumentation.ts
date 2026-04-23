/**
 * Next.js instrumentation hook.
 *
 * NO-OP BEHAVIOR: If SENTRY_DSN is not set, the runtime imports are skipped
 * entirely and nothing Sentry-related runs. Set SENTRY_DSN to activate.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(
  ...args: Parameters<
    NonNullable<typeof import("@sentry/nextjs").captureRequestError>
  >
) {
  if (!process.env.SENTRY_DSN) return;
  const { captureRequestError } = await import("@sentry/nextjs");
  return captureRequestError(...args);
}
