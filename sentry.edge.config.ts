/**
 * Sentry edge runtime configuration (middleware, edge routes).
 *
 * NO-OP BEHAVIOR: If SENTRY_DSN is not set, Sentry.init() is never called.
 * The app runs exactly as if Sentry were not installed. Set SENTRY_DSN to
 * activate.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sampleRate: 1.0,
    tracesSampleRate: 0.1,
  });
}
