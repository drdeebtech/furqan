/**
 * String-sanitization helpers for untrusted, user-controlled values that get
 * placed into structured outbound channels (email headers, Telegram HTML
 * messages, etc.). Pure and isomorphic.
 */

/**
 * Escapes the five HTML-significant characters. Use for any user value placed
 * into an HTML context we render ourselves — e.g. Telegram `parse_mode: HTML`
 * messages — so an attacker-supplied name can't inject `<a>`/markup into an
 * operator's alert.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Strips CR/LF (and other control chars) and caps length, for user values
 * interpolated into single-line headers such as an email `Subject`. Prevents
 * header-injection / extra-header smuggling via `\r\n` in a name field.
 */
export function sanitizeHeaderValue(value: string, maxLen = 200): string {
  return value.replace(/[\r\n\t\x00]+/g, " ").trim().slice(0, maxLen);
}
