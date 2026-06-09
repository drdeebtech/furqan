/**
 * URL / redirect-target safety helpers.
 *
 * Pure and isomorphic — safe to import from both Server Components/Actions and
 * Client Components (no `server-only`, no Node APIs). Centralizes the
 * same-origin redirect check and the `href` scheme check so every call site
 * gets the same hardened behavior (previously each site rolled its own and
 * several missed the backslash / CRLF / `..` cases).
 */

/**
 * True when `path` is a safe SAME-ORIGIN relative path suitable to use as a
 * redirect target.
 *
 * Rejects:
 *  - non-relative / empty values (must start with a single `/`)
 *  - protocol-relative URLs (`//evil.com`) — would navigate cross-origin
 *  - backslashes (`/\evil.com`) — browsers normalize `\` → `/`, so this is an
 *    open-redirect bypass of a naive `!startsWith("//")` check
 *  - CR / LF / NUL — header-injection / response-splitting characters
 *  - `..` path segments — traversal
 */
export function isSafeRelativePath(
  path: string | null | undefined,
): path is string {
  if (!path || !path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (/[\r\n\x00\\]/.test(path)) return false;
  if (path.split("/").includes("..")) return false;
  // Also reject percent-encoded variants of the above (`%2e%2e`, `%5c`,
  // `%0d%0a`): decode once and re-check, so an encoded payload can't slip a
  // traversal / backslash / CRLF past the raw checks.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false; // malformed % sequence
  }
  if (/[\r\n\x00\\]/.test(decoded)) return false;
  if (decoded.split("/").includes("..")) return false;
  return true;
}

/**
 * Returns `raw` only when it is safe to place in an anchor `href` — an
 * `http(s)` absolute URL, or a safe same-origin relative path. Anything else
 * (notably `javascript:`, `data:`, `vbscript:` URIs that execute script on
 * click) collapses to `fallback` (default `"#"`).
 *
 * Use at EVERY `href={userControlledValue}` site. Validating at the write
 * boundary is the primary defense; this is the render-time backstop.
 */
export function safeHref(
  raw: string | null | undefined,
  fallback = "#",
): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  // Same-origin relative path (but not protocol-relative).
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return /[\r\n\x00\\]/.test(trimmed) ? fallback : trimmed;
  }
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:" ? trimmed : fallback;
  } catch {
    return fallback;
  }
}
