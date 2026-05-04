"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Tiny client component whose only job is to flip the Sentry `hydrated` tag
 * from "false" to "true" once React successfully mounts in the browser.
 *
 * Why: the 2026-05-04 CSP outage spent 10 hours undiagnosed because the
 * symptom — page renders skeleton, never hydrates, no error thrown — was
 * invisible in Sentry. Errors that fire before any client mount succeeds are
 * now auto-tagged `hydrated:false`, surfacing the silent-failure class as a
 * filterable signal rather than a guessing game.
 *
 * The `instrumentation-client.ts` Sentry init seeds the tag as "false". This
 * component flips it to "true" inside a `useEffect`, which only runs after
 * React has actually hydrated and mounted. Any error captured between page
 * load and successful hydration retains tag `hydrated:false`.
 *
 * Renders nothing.
 */
export function HydrationBeacon() {
  useEffect(() => {
    Sentry.setTag("hydrated", "true");
    Sentry.addBreadcrumb({
      category: "hydration",
      level: "info",
      message: "client hydrated successfully",
    });
  }, []);
  return null;
}
