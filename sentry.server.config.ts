// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { getEnv } from "@vercel/functions";
import { beforeSend } from "@/lib/sentry/before-send";

// `||` not `??` — Vercel sometimes stores envs as empty strings rather than
// unset, which would silently no-op Sentry.init({dsn: ""}). Also normalize
// the legacy project DSN if an old Vercel env override still points server
// check-ins at javascript-nextjs instead of javascript-nextjs-e4.
const canonicalDsn =
  "https://e75e135004c761a09b8c2c013d095686@o4511287545954304.ingest.de.sentry.io/4511305365323856";
const rawDsn = process.env.SENTRY_DSN?.trim() || canonicalDsn;
const dsn = rawDsn.includes("/4511287551197264") ? canonicalDsn : rawDsn;

// Vercel system env vars — pulled via @vercel/functions getEnv() so every
// captured event is filterable by deployment, region, and commit. Local
// dev gets "unknown" placeholders; production gets the real values.
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
