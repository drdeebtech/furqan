// This file configures the initialization of Sentry on the client/browser.
// The config you add here will be used whenever a page is visited.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
//
// Sprint 1.2 (2026-05-05): created to close the gap exposed by the
// Phase 2B audit. Server + edge configs existed before today; client
// did not, which meant any browser-side runtime error (uncaught promise
// rejection, render error past an error boundary, hydration mismatch
// not handled by Next.js) would fall on the floor instead of reaching
// Sentry. Mirrors the server.config + edge.config posture exactly.

import * as Sentry from "@sentry/nextjs";
import { beforeSend } from "@/lib/sentry/before-send";

// Same canonical-DSN normalization as server.config.ts. NEXT_PUBLIC_SENTRY_DSN
// is bundled into the client and may be set to the legacy project URL via an
// old Vercel env override; force it to the consolidated javascript-nextjs-e4
// project so browser errors land alongside server errors. `||` not `??` —
// Vercel sometimes stores envs as empty strings rather than unset, which
// would silently no-op Sentry.init({dsn: ""}).
const canonicalDsn =
  "https://e75e135004c761a09b8c2c013d095686@o4511287545954304.ingest.de.sentry.io/4511305365323856";
const rawDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || canonicalDsn;
const dsn = rawDsn.includes("/4511287551197264") ? canonicalDsn : rawDsn;

Sentry.init({
  dsn,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  tracesSampleRate: process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ? 0.1 : 1,
  enableLogs: true,
  sendDefaultPii: true,
  beforeSend,
});
