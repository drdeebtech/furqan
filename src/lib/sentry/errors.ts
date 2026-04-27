// Typed error classes for new code. Each has a custom `.name` so Sentry
// groups them into their own issues (default Error groups everything
// together, which makes triage painful). The `beforeSend` hook in
// before-send.ts auto-derives a tag like `error.kind: auth` from each.
//
// USAGE: prefer these over `throw new Error(...)` in new code. Existing
// `throw new Error(...)` sites keep working — no migration is required.
//
//   throw new AuthError("Invalid credentials", { kind: "bad-credentials" });
//   throw new IntegrationError("n8n unreachable", { kind: "n8n", upstreamStatus: 502, cause: err });
//
// The `kind` arg becomes a Sentry context tag for further filterability;
// `metadata` becomes a Sentry context block; `cause` chains the original
// error so the stack remains usable.

interface BaseErrorOpts {
  kind?: string;
  metadata?: Record<string, unknown>;
  cause?: unknown;
}

abstract class TaggedError extends Error {
  readonly kind?: string;
  readonly metadata?: Record<string, unknown>;
  constructor(message: string, opts?: BaseErrorOpts) {
    super(message, opts?.cause ? { cause: opts.cause } : undefined);
    this.kind = opts?.kind;
    this.metadata = opts?.metadata;
    // Make the prototype chain show up correctly for instanceof checks
    // even after the SWC/Turbopack transform.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Auth: login, register, forgot-password, BotID, rate-limit, session-expired. */
export class AuthError extends TaggedError {
  override name = "AuthError";
}

/** Booking: validation, scheduling conflict, package balance, time-window. */
export class BookingError extends TaggedError {
  override name = "BookingError";
}

/** Session: Daily.co create/join, observer token, recording. */
export class SessionError extends TaggedError {
  override name = "SessionError";
}

/** Upstream integrations: n8n, Resend, Telegram, Stripe, CallMeBot. */
export class IntegrationError extends TaggedError {
  override name = "IntegrationError";
  readonly upstreamStatus?: number;
  constructor(message: string, opts?: BaseErrorOpts & { upstreamStatus?: number }) {
    super(message, opts);
    this.upstreamStatus = opts?.upstreamStatus;
  }
}

/** Validation: zod failures, malformed inputs, type guard rejects. */
export class ValidationError extends TaggedError {
  override name = "ValidationError";
}

/** Type guard so callers can narrow safely. */
export function isTaggedError(err: unknown): err is TaggedError {
  return err instanceof TaggedError;
}
