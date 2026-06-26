// Sentry + BotID client bootstrap. Sentry MUST initialize before BotID so a
// throwing initBotId() can't take down error reporting before it boots.
// Empty-string envs are treated as missing (|| not ??) — Vercel sometimes
// stores envs as empty strings rather than unset, which would silently
// no-op Sentry.init({dsn: ""}).

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import { initBotId } from "botid/client/core";
import { beforeSend, CLIENT_IGNORE_ERRORS } from "@/lib/sentry/before-send";

// Canonical DSN — same project as sentry.server.config.ts so client + server
// events land together in furqan-academy/javascript-nextjs-e4 (project
// 4511305365323856). Some older Vercel environments still carry the legacy
// project DSN (4511287551197264); normalize that stale override back to the
// canonical DSN so browser events stop splitting across two Sentry projects.
const canonicalDsn =
  "https://e75e135004c761a09b8c2c013d095686@o4511287545954304.ingest.de.sentry.io/4511305365323856";
const rawDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || canonicalDsn;
const dsn = rawDsn.includes("/4511287551197264") ? canonicalDsn : rawDsn;

const isProd = process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

Sentry.init({
  dsn,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
    // User Feedback widget — Sentry's launcher is suppressed (autoInject:
    // false) because its viewport-anchored bottom-right position collides
    // with the Support nav icon on furqan's layout. Instead we trigger the
    // same dialog from the topbar overflow menu via
    // `Sentry.getFeedback()?.openDialog()` in src/components/shared/topbar.tsx.
    // The integration must still be loaded so getFeedback() returns the widget.
    Sentry.feedbackIntegration({
      colorScheme: "system",
      showBranding: false,
      autoInject: false,
      triggerLabel: "أبلغ عن مشكلة",
      formTitle: "أبلغ عن مشكلة",
      submitButtonLabel: "إرسال",
      cancelButtonLabel: "إلغاء",
      nameLabel: "الاسم",
      namePlaceholder: "اسمك",
      emailLabel: "البريد الإلكتروني",
      emailPlaceholder: "بريدك الإلكتروني",
      messageLabel: "الوصف",
      messagePlaceholder: "ماذا حدث؟",
      successMessageText: "شكرًا، تم إرسال البلاغ.",
    }),
    // Capture console.error/console.warn as breadcrumbs on the next error event.
    // Lesson from the 2026-05-04 CSP outage: 19 CSP violations were logged to
    // browser console but never reached Sentry as Issues — they go to a separate
    // report-uri channel that wasn't surfaced. Capturing them as breadcrumbs
    // means the next *real* error has a trail of any preceding console noise,
    // and silent script-block failures get hints about what was blocked.
    Sentry.captureConsoleIntegration({ levels: ["error", "warn"] }),
  ],
  tracesSampleRate: isProd ? 0.1 : 1,
  enableLogs: true,
  replaysSessionSampleRate: isProd ? 0.05 : 0,
  replaysOnErrorSampleRate: 1.0,
  sendDefaultPii: true,
  beforeSend,
  ignoreErrors: CLIENT_IGNORE_ERRORS,
});

// Initial state: page loaded but React hasn't hydrated yet. The
// HydrationBeacon component (rendered in the root layout) flips this to "true"
// once mounted. Any error fired before that point is automatically tagged
// hydrated:false — separates "user did a thing, broke" from "client never
// successfully booted." Lesson from the 2026-05-04 CSP outage: silent
// hydration failure was indistinguishable from "user is just slow" in the
// issue feed.
Sentry.setTag("hydrated", "false");

try {
  initBotId({
    protect: [
      { path: "/login", method: "POST" },
      { path: "/register", method: "POST" },
      { path: "/forgot-password", method: "POST" },
      { path: "/student/bookings/new", method: "POST" },
      { path: "/teach-with-us/apply", method: "POST" },
      { path: "/contact", method: "POST" },
    ],
  });
} catch (err) {
  // Don't let BotID failures cascade into a broken page or silenced Sentry.
  Sentry.captureException(err, { tags: { component: "botid.init" } });
}

// PostHog product analytics. Fail-soft: if the key is unset (local dev, or
// before the env var is configured) we simply don't initialize — no crash, no
// build break. US host by default to match the PostHog account's region
// (us.posthog.com). Session recording is OFF so we never capture student PII;
// errors stay with Sentry (capture_exceptions: false). `defaults` enables
// automatic pageview/pageleave capture that understands App Router navigation,
// so no manual pageview wiring is needed.
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com",
    defaults: "2025-05-24",
    capture_exceptions: false,
    disable_session_recording: true,
    person_profiles: "identified_only",
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
