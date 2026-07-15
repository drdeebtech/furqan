"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { mixpanelClient } from "@/lib/mixpanel-client";

/**
 * Links the browser to the authenticated user for both analytics tools.
 * Rendered by authenticated layouts with the server-resolved userId — never
 * a client-supplied value. (Renamed from PostHogIdentify when Mixpanel was
 * added.) Counterpart: both tools reset() in logout-button.tsx.
 */
export function AnalyticsIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    posthog.identify(userId);
    mixpanelClient()?.identify(userId);
  }, [userId]);

  return null;
}
