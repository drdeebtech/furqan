// Sentry + BotID client bootstrap. Sentry MUST initialize before BotID so a
// throwing initBotId() can't take down error reporting before it boots.
// Empty-string envs are treated as missing (|| not ??) — Vercel sometimes
// stores envs as empty strings rather than unset, which would silently
// no-op Sentry.init({dsn: ""}).

import * as Sentry from "@sentry/nextjs";
import { initBotId } from "botid/client/core";
import { beforeSend, CLIENT_IGNORE_ERRORS } from "@/lib/sentry/before-send";

// Canonical DSN — same project as sentry.server.config.ts so client + server
// events land together in furqan-academy/javascript-nextjs-e4 (project
// 4511305365323856). The previous fallback pointed at the legacy
// javascript-nextjs project (4511287551197264), which silently split errors
// across two dashboards. Env override still wins so Vercel can rotate DSNs
// without a code change.
const dsn =
  process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() ||
  "https://e75e135004c761a09b8c2c013d095686@o4511287545954304.ingest.de.sentry.io/4511305365323856";

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
  ],
  tracesSampleRate: isProd ? 0.1 : 1,
  enableLogs: true,
  replaysSessionSampleRate: isProd ? 0.05 : 0,
  replaysOnErrorSampleRate: 1.0,
  sendDefaultPii: true,
  beforeSend,
  ignoreErrors: CLIENT_IGNORE_ERRORS,
});

try {
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
} catch (err) {
  // Don't let BotID failures cascade into a broken page or silenced Sentry.
  Sentry.captureException(err, { tags: { component: "botid.init" } });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
