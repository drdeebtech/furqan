// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { getEnv } from "@vercel/functions";
import { beforeSend } from "@/lib/sentry/before-send";

// Normalize stale legacy-project env overrides so edge check-ins and errors
// land in the consolidated javascript-nextjs-e4 project.
const canonicalDsn =
  "https://e75e135004c761a09b8c2c013d095686@o4511287545954304.ingest.de.sentry.io/4511305365323856";
const rawDsn = process.env.SENTRY_DSN?.trim() || canonicalDsn;
const dsn = rawDsn.includes("/4511287551197264") ? canonicalDsn : rawDsn;

const env = getEnv();

Sentry.init({
  dsn,
  environment: process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: process.env.VERCEL_ENV === "production" ? 0.1 : 1,
  enableLogs: true,
  sendDefaultPii: true,
  beforeSend,
  initialScope: {
    tags: {
      vercel_env: env.VERCEL_ENV ?? "unknown",
      vercel_region: env.VERCEL_REGION ?? "unknown",
      vercel_deployment_id: env.VERCEL_DEPLOYMENT_ID ?? "unknown",
      vercel_git_commit_sha: env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
    },
  },
});
