// Sentry + BotID client bootstrap. Sentry MUST initialize before BotID so a
// throwing initBotId() can't take down error reporting before it boots.
// Empty-string envs are treated as missing (|| not ??) — Vercel sometimes
// stores envs as empty strings rather than unset, which would silently
// no-op Sentry.init({dsn: ""}).

import * as Sentry from "@sentry/nextjs";
import { initBotId } from "botid/client/core";
import { beforeSend, CLIENT_IGNORE_ERRORS } from "@/lib/sentry/before-send";

const dsn =
  process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() ||
  "https://3e6ba831bf5a932017cd9999e2b066ac@o4511287545954304.ingest.de.sentry.io/4511287551197264";

const isProd = process.env.NEXT_PUBLIC_VERCEL_ENV === "production";

Sentry.init({
  dsn,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
    // User Feedback widget — adds a floating "Report a problem" button.
    // Auto-injects globally; users can describe a bug in their own words
    // and Sentry creates a feedback issue with their session replay attached.
    Sentry.feedbackIntegration({
      colorScheme: "system",
      showBranding: false,
      autoInject: isProd,
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
