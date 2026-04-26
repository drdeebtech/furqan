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

/**
 * Sentry browser-side init. Replaces the older `sentry.client.config.ts`
 * pattern, which Next.js 13+ ignores in favor of `instrumentation-client.ts`.
 * Without this, browser/client-component errors silently drop even with the
 * DSN set.
 *
 * NO-OP BEHAVIOR: If NEXT_PUBLIC_SENTRY_DSN is not set, Sentry.init() is
 * never called. Set the env var to activate.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    sampleRate: 1.0,
    tracesSampleRate: 0.1,
  });
}

/**
 * App Router navigation transitions — required for client-side route
 * tracing to work correctly in Next.js 13+.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
