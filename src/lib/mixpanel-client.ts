import mixpanel from "mixpanel-browser";

/**
 * Client-side Mixpanel bootstrap. Fail-soft like PostHog: no token → never
 * initialized → every consumer gets null and no-ops (no crash, no build
 * break). Privacy stance mirrors the PostHog init in
 * instrumentation-client.ts (students, possibly minors): autocapture OFF so
 * no DOM text/input values are collected, session recording stays at its
 * default of 0%. Pageviews on for page-level funnels.
 */
let initialized = false;

export function initMixpanel(): void {
  const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN?.trim();
  if (!token || initialized) return;
  mixpanel.init(token, {
    autocapture: false,
    track_pageview: true,
    persistence: "localStorage",
  });
  initialized = true;
}

/** The live client when initialized, else null — callers optional-chain. */
export function mixpanelClient(): typeof mixpanel | null {
  return initialized ? mixpanel : null;
}
