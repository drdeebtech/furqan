/**
 * Sprint 1.1 (2026-05-05): Supabase silent-fail observability wrapper.
 *
 * The 2026-05-05 process audit caught 4 production bugs (F1, F13, F14,
 * F15) where PostgREST returned 4xx and the calling code silently
 * defaulted to `?? []` or `?? null`. The errors were invisible to
 * Sentry, monitoring, typecheck, and the team for weeks at a time.
 *
 * This wrapper intercepts every Supabase HTTP request via the
 * `global.fetch` option supabase-js exposes. On any non-2xx PostgREST
 * response (URL contains `/rest/v1/` or `/storage/v1/` or `/auth/v1/`),
 * it forwards a structured event to `logError()` — which routes to
 * Sentry + Telegram for critical severity per the existing pipeline.
 *
 * **Behavior is unchanged.** The fetch returns the original Response
 * untouched; the calling code's `?? []` fallback still runs. The wrapper
 * is observation-only. Future sprints can migrate the silent-fail call
 * sites to `loudAction` + `<ActionFeedback>`; this sprint just makes
 * the failures *visible* so they stop hiding.
 *
 * **Why structured-event-not-throw:** throwing here would change the
 * behavior of every existing `?? []` site simultaneously, which is
 * exactly the migration the team has chosen to phase. Logging plus
 * letting the original return continue is the safe insertion point.
 */

import { logError } from "@/lib/logger";

// Light heuristic — these are the path prefixes Supabase uses for the
// three observable APIs. We don't intercept the realtime websocket because
// it doesn't go through fetch. Auth errors are usually shown directly to
// the user (login failed) but we still log the underlying 4xx for trail.
const SUPABASE_API_PATHS = ["/rest/v1/", "/storage/v1/", "/auth/v1/"];

function isSupabaseApiUrl(url: string): boolean {
  return SUPABASE_API_PATHS.some((prefix) => url.includes(prefix));
}

function summarizeRequest(url: string, method: string): string {
  // Strip the protocol+host so the message is short and grouping-friendly
  // in Sentry. The path alone is the useful key.
  try {
    const u = new URL(url);
    return `${method} ${u.pathname}${u.search}`.slice(0, 200);
  } catch {
    return `${method} ${url}`.slice(0, 200);
  }
}

/**
 * Returns a fetch function suitable for the `global.fetch` option of
 * supabase-js. Pass-through on success; structured log on non-2xx.
 *
 * Critical: must use the platform-native fetch passed by the caller
 * (or `globalThis.fetch`), not import `node-fetch` or anything else —
 * doing so would break the @supabase/ssr cookie-handling assumptions
 * that depend on the runtime's own fetch.
 */
export function createObservedFetch(
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async function observedFetch(input, init) {
    const response = await baseFetch(input, init);

    // Don't observe non-Supabase URLs that might pass through if the
    // caller swaps fetch globally (defensive — supabase-js only calls
    // its own URLs but better to filter than over-report).
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isSupabaseApiUrl(url)) return response;

    // 2xx = OK, 3xx redirect = OK (supabase-js follows automatically).
    // 401 from auth API is expected on token refresh — skip to avoid noise.
    if (response.ok) return response;
    if (url.includes("/auth/v1/") && response.status === 401) return response;

    const method = init?.method ?? "GET";
    const summary = summarizeRequest(url, method);

    // Try to read the JSON body for the PostgREST error payload, but
    // clone first so the caller still gets the un-consumed Response.
    let bodyText = "";
    try {
      bodyText = await response.clone().text();
    } catch {
      // Body unreadable (already consumed somewhere?) — log without it.
    }

    logError(
      `supabase.silent_fail ${response.status} ${summary}`,
      new Error(bodyText.slice(0, 800) || `Supabase ${response.status}`),
      {
        tag: "supabase",
        severity: response.status >= 500 ? "critical" : "warning",
        metadata: {
          status: response.status,
          method,
          url: summary,
        },
      },
    );

    return response;
  };
}
