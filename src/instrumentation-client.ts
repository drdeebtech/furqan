// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { initBotId } from "botid/client/core";
import * as Sentry from "@sentry/nextjs";

/**
 * Vercel BotID — invisible CAPTCHA on high-value public endpoints.
 * Paths listed here are page routes that invoke a protected server action.
 * The server action itself must call `checkBotId()` from `botid/server`.
 *
 * Free tier (Basic) runs by default. Deep Analysis toggle lives in
 * Vercel Firewall → Rules → Vercel BotID Deep Analysis.
 */
initBotId({
  protect: [
    { path: "/login", method: "POST" },
    { path: "/register", method: "POST" },
    { path: "/forgot-password", method: "POST" },
    { path: "/student/bookings/new", method: "POST" },
    { path: "/teach/apply", method: "POST" },
    { path: "/contact", method: "POST" },
  ],
});

Sentry.init({
  dsn: "https://3e6ba831bf5a932017cd9999e2b066ac@o4511287545954304.ingest.de.sentry.io/4511287551197264",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // Lowered from the wizard's default 0.1 (10%) → 0.05 (5%) so we don't
  // burn through Sentry's free-tier session quota during normal traffic.
  // 100% of *error* sessions still record (replaysOnErrorSampleRate).
  replaysSessionSampleRate: 0.05,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});

/**
 * App Router navigation transitions — required for client-side route
 * tracing to work correctly in Next.js 13+.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
