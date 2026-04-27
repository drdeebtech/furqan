// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ??
    "https://3e6ba831bf5a932017cd9999e2b066ac@o4511287545954304.ingest.de.sentry.io/4511287551197264",

  tracesSampleRate: process.env.VERCEL_ENV === "production" ? 0.1 : 1,

  enableLogs: true,

  sendDefaultPii: true,
});
