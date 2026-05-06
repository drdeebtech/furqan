import "server-only";

/**
 * Edge Config read shim for hot platform_settings flags.
 *
 * Stream 7A — adds a sub-1ms global read path for flags that proxy.ts
 * middleware and frequent server actions hit on every request. When
 * the EDGE_CONFIG env var is unset (local dev, OR prod before the user
 * has provisioned the Edge Config store), every call falls through to
 * `null` and callers continue to read from Postgres.
 *
 * Source of truth stays in `platform_settings` (Postgres). Edge Config
 * is a read-only cache layer populated manually via the Vercel
 * dashboard — admins maintaining the source of truth in Postgres can
 * mirror only the flags they want fast-pathed. Future PR can wire an
 * automated sync from `updatePlatformSetting` once a Vercel API token
 * is wired into the project.
 *
 * Why a shim and not direct `get(name)` calls everywhere:
 *   - Single guard for the EDGE_CONFIG-unset case (no scattered try/catch)
 *   - Single Sentry/console log point for unexpected EC failures
 *   - Future: easy to extend to multi-key reads or batched gets
 */

/**
 * Returns the Edge Config value for `name`, or `null` when:
 *   - EDGE_CONFIG env var is unset (Edge Config not provisioned)
 *   - The key isn't in the Edge Config store
 *   - The Edge Config service is transiently unavailable
 *
 * Callers should treat `null` as a cache miss and fall through to
 * their authoritative source (Postgres for flags).
 */
export async function getFlag(name: string): Promise<string | null> {
  if (!process.env.EDGE_CONFIG) {
    // Edge Config not provisioned — caller falls through to Postgres.
    // No error logged; this is the steady-state for local dev and
    // initial Pro setup before the store is created.
    return null;
  }

  try {
    // Lazy import so production bundles don't pull the SDK when
    // EDGE_CONFIG is unset (the early-return above hands back null
    // without ever evaluating this branch in that path).
    const { get } = await import("@vercel/edge-config");
    const value = await get<string>(name);
    return value ?? null;
  } catch {
    // Tolerate transient EC outages — caller falls back to Postgres.
    // No Sentry log here because flag reads happen on every request:
    // a single EC blip would flood Sentry. Postgres fallback is the
    // safety net.
    return null;
  }
}

/**
 * Convenience wrapper for the boolean-flag pattern. Returns `null`
 * when Edge Config has no answer, so callers can distinguish "EC says
 * false" from "EC has no value" — the latter triggers Postgres
 * fallback, the former is authoritative.
 */
export async function getBooleanFlag(name: string): Promise<boolean | null> {
  const value = await getFlag(name);
  if (value === null) return null;
  return value === "true";
}
