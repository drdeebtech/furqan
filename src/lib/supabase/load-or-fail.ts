import { logError } from "@/lib/logger";

/**
 * Read-side companion to `loudAction`. Wraps a Supabase query result
 * (`{ data, error }`) so:
 *
 *  1. If `error` is set, it's piped through `logError` with a stable tag
 *     so Sentry sees structured context (the route, what was being
 *     loaded, the operator-supplied tag).
 *  2. The shape returned is `{ data, failed }` where `data` falls back
 *     to the supplied default. Pages can render the data normally and
 *     additionally surface a "this widget failed to load" banner when
 *     ANY load on the page returned `failed: true`.
 *
 * The Sprint 1.1 fetch wrapper at `observability.ts` already logs every
 * non-2xx Supabase response to Sentry — but it doesn't know WHAT the
 * caller was trying to load, so the breadcrumbs are flat URLs. This
 * helper attaches the intent, so a Sentry event reads
 * "student-dashboard.next-booking failed" instead of just
 * "GET /rest/v1/bookings 400".
 *
 * Usage:
 *   const { data: nextBooking, failed: nextFailed } = loadOrFail(
 *     await supabase.from("bookings").select(...).eq(...),
 *     [],
 *     { route: "student-dashboard", widget: "next-booking" },
 *   );
 *
 *   const anyFailed = nextFailed || otherFailed || ...;
 *   return <Dashboard ... anyFailed={anyFailed} />;
 */
export type LoadOrFailContext = {
  /** The route or surface this load belongs to (e.g. "student-dashboard"). */
  route: string;
  /** Logical widget / data-need (e.g. "next-booking", "active-packages"). */
  widget: string;
  /** Optional extra metadata to attach to the Sentry event. */
  metadata?: Record<string, unknown>;
};

export type LoadResult<T> = {
  data: T;
  failed: boolean;
};

/**
 * @param result   The awaited Supabase result `{ data, error }`.
 * @param fallback Value to return when `data` is null OR `error` is set.
 * @param ctx      Context for the Sentry event when load fails.
 */
export function loadOrFail<T>(
  result: { data: T | null; error: { message: string; code?: string } | null },
  fallback: T,
  ctx: LoadOrFailContext,
): LoadResult<T> {
  if (result.error) {
    logError(`load ${ctx.route}.${ctx.widget} failed`, result.error, {
      tag: "data-load",
      severity: "warning",
      route: ctx.route,
      metadata: { widget: ctx.widget, ...(ctx.metadata ?? {}) },
    });
    return { data: fallback, failed: true };
  }
  return { data: result.data ?? fallback, failed: false };
}
