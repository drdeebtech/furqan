import "server-only";

/**
 * One definition of what a checkout route says when its payment provider is not
 * configured on this server.
 *
 * Every checkout route (`/api/stripe/checkout`, `.../single-session`,
 * `.../prepaid-hours`, `/api/paypal/checkout/prepaid-hours`) reaches this state
 * the same way — the secret key / API base is absent — and every client renders
 * `body.error` verbatim to the student. Before this constant the routes
 * disagreed: one threw unhandled (Sentry FURQAN-4C, so the student saw
 * "connection failed — check your internet"), the others answered a bare English
 * "Server misconfigured" to an Arabic-first audience. Same cause, three
 * different lies.
 *
 * The copy is deliberately bilingual and deliberately vague about the cause: it
 * must be honest to the student without disclosing which provider or which
 * variable is missing (security: error messages don't leak internals).
 */
export const PAYMENTS_UNAVAILABLE_MESSAGE =
  "الدفع غير متاح حالياً — يرجى المحاولة لاحقاً. Payments are temporarily unavailable, please try again later.";

/**
 * 503, not 500. The server is healthy and the request was well-formed — the
 * payment provider simply is not wired up yet, so "try again later" is accurate
 * advice rather than a generic failure. 500 would also read as a bug to any
 * uptime monitor pointed at these routes.
 */
export const PAYMENTS_UNAVAILABLE_STATUS = 503;
