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

/**
 * Count-only sibling for HEAD/count queries (`select("id", { count: "exact", head: true })`).
 * Same observability shape, returns `{ count, failed }`.
 */
export type CountResult = {
  count: number;
  failed: boolean;
};

export function countOrFail(
  result: { count: number | null; error: { message: string; code?: string } | null },
  ctx: LoadOrFailContext,
): CountResult {
  if (result.error) {
    logError(`count ${ctx.route}.${ctx.widget} failed`, result.error, {
      tag: "data-load",
      severity: "warning",
      route: ctx.route,
      metadata: { widget: ctx.widget, ...(ctx.metadata ?? {}) },
    });
    return { count: 0, failed: true };
  }
  return { count: result.count ?? 0, failed: false };
}

/**
 * Wrap an async helper function call so that any thrown error is
 * caught, logged with widget tags, and translated into a fallback
 * `{ data, failed: true }` shape. Companion to `loadOrFail`/`countOrFail`
 * for helpers that compose multiple supabase queries — the helper
 * itself decides when to throw, the caller decides what to render
 * when the helper failed.
 *
 * Usage:
 *   const weeklyHoursLoad = await helperOrFail(
 *     () => getTeacherWeeklyHours(user.id),
 *     [],
 *     { route: "teacher-dashboard", widget: "weekly-hours" },
 *   );
 *   anyFailed = anyFailed || weeklyHoursLoad.failed;
 *   const weeklyHours = weeklyHoursLoad.data;
 */
export async function helperOrFail<T>(
  call: () => Promise<T>,
  fallback: T,
  ctx: LoadOrFailContext,
): Promise<LoadResult<T>> {
  try {
    const data = await call();
    return { data, failed: false };
  } catch (err) {
    // Temporary diagnostic — also write to console so Vercel runtime
    // logs surface the failing widget without needing Sentry MCP. Remove
    // once the unknown failing helper is identified.
    console.error(`[helperOrFail] ${ctx.route}.${ctx.widget} threw:`, err);
    logError(`helper ${ctx.route}.${ctx.widget} threw`, err, {
      tag: "data-load",
      severity: "warning",
      route: ctx.route,
      metadata: { widget: ctx.widget, ...(ctx.metadata ?? {}) },
    });
    return { data: fallback, failed: true };
  }
}
