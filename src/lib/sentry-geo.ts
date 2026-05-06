import "server-only";
import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";

/**
 * Read Vercel-injected geolocation headers and attach them to the
 * current Sentry scope as tags. Once attached, any Sentry event
 * captured during this request inherits the geo tags so triage in the
 * Sentry UI can filter by `geo.country` / `geo.region` / `geo.city`.
 *
 * Safe to call repeatedly — `setTag` is idempotent on the scope.
 *
 * On Vercel, the headers are populated by the platform (not from any
 * trusted browser-side source), so they're safe to log. City names are
 * URI-encoded by Vercel; we decode for human readability.
 *
 * Local dev (no Vercel proxy in front) → headers are absent → tags fall
 * back to "unknown" rather than failing the action.
 */
export async function attachGeoToSentryScope(): Promise<void> {
  try {
    const h = await headers();
    const country = h.get("x-vercel-ip-country") ?? "unknown";
    const region = h.get("x-vercel-ip-country-region") ?? "unknown";
    const cityRaw = h.get("x-vercel-ip-city") ?? "unknown";
    const city = cityRaw === "unknown" ? cityRaw : decodeURIComponent(cityRaw);
    Sentry.setTag?.("geo.country", country);
    Sentry.setTag?.("geo.region", region);
    Sentry.setTag?.("geo.city", city);
  } catch {
    // headers() can throw outside a request context (e.g. during
    // certain edge-cache rebuild paths). Silent fall-through is
    // correct — Sentry just doesn't get the geo tag for that event.
  }
}
