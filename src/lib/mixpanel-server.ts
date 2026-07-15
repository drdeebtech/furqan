import { logError } from "@/lib/logger";
import { withTimeout } from "@/lib/promise-utils";

/**
 * Server-side Mixpanel tracking via the HTTP ingestion API — no SDK
 * dependency. Used for events whose client-side surface is deliberately
 * ambiguous (register's enumeration-safe redirect) or server-authoritative
 * (booking confirmation), so counts stay accurate.
 *
 * Fail-soft: missing token → no-op; network errors are logged, never thrown —
 * analytics must not break auth or booking flows. The call is bounded so a
 * slow ingest endpoint can't hold a Server Action's response.
 *
 * `?ip=0` stops Mixpanel geolocating events from the server's IP.
 */
const MIXPANEL_TRACK_URL = "https://api.mixpanel.com/track?ip=0";
const TRACK_TIMEOUT_MS = 2000;

// Typed event names only (repo convention, mirrors FurqanEvent): add new
// events here, never as inline strings at call sites.
export const MIXPANEL_EVENTS = {
  SIGN_UP_COMPLETED: "sign_up_completed",
  BOOKING_CONFIRMED: "booking_confirmed",
} as const;

export type MixpanelEvent = (typeof MIXPANEL_EVENTS)[keyof typeof MIXPANEL_EVENTS];

export async function trackMixpanel(
  distinctId: string,
  event: MixpanelEvent,
  properties: Record<string, string | number | boolean> = {},
): Promise<void> {
  const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN?.trim();
  if (!token) return;
  try {
    await withTimeout(
      fetch(MIXPANEL_TRACK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/plain" },
        body: JSON.stringify([
          {
            event,
            properties: {
              token,
              distinct_id: distinctId,
              time: Date.now(),
              $insert_id: crypto.randomUUID(),
              ...properties,
            },
          },
        ]),
      }),
      TRACK_TIMEOUT_MS,
      null as never,
      `mixpanel:${event}`,
    );
  } catch (err) {
    logError(`mixpanel track failed (${event})`, err, { tag: "analytics" });
  }
}
