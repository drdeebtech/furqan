// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { beforeSend } from "@/lib/sentry/before-send";

const dsn =
  process.env.SENTRY_DSN?.trim() ||
  "https://e75e135004c761a09b8c2c013d095686@o4511287545954304.ingest.de.sentry.io/4511305365323856";

Sentry.init({
  dsn,
  environment: process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: process.env.VERCEL_ENV === "production" ? 0.1 : 1,
  enableLogs: true,
  sendDefaultPii: true,
  beforeSend,
});
