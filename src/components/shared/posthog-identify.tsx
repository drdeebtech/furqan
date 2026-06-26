"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export function PostHogIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    posthog.identify(userId);
  }, [userId]);

  return null;
}
