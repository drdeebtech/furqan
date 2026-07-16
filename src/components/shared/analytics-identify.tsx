"use client";

import { useEffect } from "react";
import { identifyAnalytics } from "@/lib/analytics-identity";

/**
 * Links the browser to the authenticated user for every analytics tool.
 * Rendered by authenticated layouts with the server-resolved userId — never
 * a client-supplied value. (Renamed from PostHogIdentify when Mixpanel was
 * added.) Counterpart: resetAnalyticsIdentities() in the logout forms.
 */
export function AnalyticsIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    identifyAnalytics(userId);
  }, [userId]);

  return null;
}
