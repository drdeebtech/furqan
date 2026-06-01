/**
 * UserError — the single, shared user-facing error class.
 *
 * Before this module, ~22 route-adapter files each declared their OWN
 * `class UserError extends Error { readonly userError = true ... }`. They were
 * byte-for-byte equivalent, but because each was a *distinct* class, a
 * cross-file `instanceof UserError` only matched by luck. `loudAction`
 * deliberately duck-types on the `userError === true` flag instead of
 * `instanceof` for exactly this reason (see `loud.ts`).
 *
 * This module makes that duck-type a real, importable contract. The shape is
 * preserved exactly (`readonly userError = true`, `(msg, options?)`
 * constructor forwarding `cause`), so:
 *   - `loudAction` still recognizes it via the `userError` flag.
 *   - `instanceof UserError` now works across files (no more luck).
 *   - The two `loudAction` sub-cases keep working unchanged:
 *       new UserError("غير مصرح")                     → silent passthrough
 *       new UserError("فشل", { cause: supabaseError }) → logged system wrap
 *
 * Use this instead of declaring a per-file `class UserError`.
 */
export class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

/**
 * Type guard mirroring `loudAction`'s internal duck-type. Returns `true` for
 * both real `UserError` instances and any error carrying the `userError`
 * flag (e.g. the `loudUserError` helper in `loud.ts`). Exported so callers
 * that need to branch on user-vs-system failure don't re-implement the check.
 */
export function isUserError(err: unknown): err is Error & { userError: true } {
  return err instanceof Error && (err as { userError?: boolean }).userError === true;
}
