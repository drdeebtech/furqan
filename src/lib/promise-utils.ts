import { logError } from "@/lib/logger";

/**
 * Split an array into fixed-size chunks. Used to keep batch jobs under
 * PostgREST's `.in()` argument cap and to bound per-statement row counts at
 * scale (e.g. the 50k-student retention scorer — audit H9).
 */
export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error("chunk size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Race `promise` against `ms` and return `fallback` if the promise doesn't
 * settle in time — or if it rejects for any reason. Use to keep one slow /
 * hung query from holding an entire `Promise.all`-driven page render hostage.
 *
 * Both timeouts and other rejections are routed through `logError` so we
 * can see the slow / failing query in Sentry without blocking the user.
 *
 * Note on cancellation: `Promise.race` does NOT cancel the loser. The
 * underlying request keeps running in the background until the function
 * timeout is reached. For Supabase, that means the connection stays held;
 * for a hotfix this is acceptable, but a follow-up should plumb
 * `AbortController` + `.abortSignal()` through Supabase queries for true
 * cancellation.
 */
export async function withTimeout<T>(
  promise: Promise<T> | PromiseLike<T>,
  ms: number,
  fallback: T,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sentinel = `__withTimeout:${label}`;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(sentinel)), ms);
      }),
    ]);
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === sentinel;
    logError(
      isTimeout ? `query timeout: ${label}` : `query error: ${label}`,
      err,
      {
        tag: isTimeout ? "query-timeout" : "query-error",
        component: "withTimeout",
        kind: isTimeout ? "timeout" : "error",
        timeoutMs: ms,
      },
    );
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
