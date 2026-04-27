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

const isProd = process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ??
    "https://3e6ba831bf5a932017cd9999e2b066ac@o4511287545954304.ingest.de.sentry.io/4511287551197264",

  integrations: [
    Sentry.replayIntegration({
      // Mask all text + form inputs and block media. The platform handles
      // student data (some minors) — full DOM capture into a 3rd-party SaaS
      // is not appropriate. Layout/structure still recorded; values are not.
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],

  tracesSampleRate: isProd ? 0.1 : 1,

  enableLogs: true,

  // 5% of normal sessions in production; off in dev/preview to save quota.
  replaysSessionSampleRate: isProd ? 0.05 : 0,

  // Always record sessions surrounding an error.
  replaysOnErrorSampleRate: 1.0,

  sendDefaultPii: true,
});

/**
 * App Router navigation transitions — required for client-side route
 * tracing to work correctly in Next.js 13+.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
