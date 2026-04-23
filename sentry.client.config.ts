/**
 * Sentry client-side configuration.
 *
 * NO-OP BEHAVIOR: If NEXT_PUBLIC_SENTRY_DSN is not set, Sentry.init() is never
 * called and nothing is shipped. The app continues to work exactly as if
 * Sentry were not installed. To activate Sentry, just set the env var.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sampleRate: 1.0,
    tracesSampleRate: 0.1,
  });
}
