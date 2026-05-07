/**
 * Auth error classes — extracted to a server-only-free module so they can be
 * unit-tested without dragging the Supabase server client into the test
 * environment. `require-admin.ts` re-exports both classes so existing
 * importers (`@/lib/auth/require-admin`) keep working unchanged.
 *
 * Per ADR-0001: `UnauthenticatedError extends ForbiddenError` so existing
 * `instanceof ForbiddenError` checks at all 38 importers still match the
 * unauthed case.
 */

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class UnauthenticatedError extends ForbiddenError {
  constructor(message = "not authenticated") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}
