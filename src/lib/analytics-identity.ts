import posthog from "posthog-js";
import { mixpanelClient } from "./mixpanel-client";

/**
 * One home for the client-side analytics identity lifecycle, so a future
 * provider can't be identified in one place and left stale in another.
 * identify: analytics-identify.tsx (authenticated layouts).
 * reset: every logout form (logout-button.tsx, nav.tsx account menu).
 */
export function identifyAnalytics(userId: string): void {
  posthog.identify(userId);
  mixpanelClient()?.identify(userId);
}

export function resetAnalyticsIdentities(): void {
  posthog.reset();
  mixpanelClient()?.reset();
}
