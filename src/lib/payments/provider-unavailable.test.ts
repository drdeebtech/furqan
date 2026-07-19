import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PAYMENTS_UNAVAILABLE_MESSAGE,
  PAYMENTS_UNAVAILABLE_STATUS,
} from "./provider-unavailable";

/**
 * These constants are USER-FACING: every checkout route hands them straight to
 * a client that renders `body.error` verbatim. The properties below are the
 * reasons the constants exist, so they get pinned rather than assumed.
 */
describe("payment-provider-unavailable contract", () => {
  it("is 503, not 500 — the server is healthy, the provider just isn't wired up", () => {
    expect(PAYMENTS_UNAVAILABLE_STATUS).toBe(503);
  });

  it("speaks Arabic as well as English (the audience is Arabic-first)", () => {
    // The old copy was the English-only "Server misconfigured".
    expect(PAYMENTS_UNAVAILABLE_MESSAGE).toMatch(/[؀-ۿ]/);
    expect(PAYMENTS_UNAVAILABLE_MESSAGE).toMatch(/[A-Za-z]/);
  });

  it("names no provider, variable, or internal detail", () => {
    // Security: error messages must not leak internals to an unauthenticated
    // or merely-curious caller.
    expect(PAYMENTS_UNAVAILABLE_MESSAGE).not.toMatch(
      /stripe|paypal|secret|key|env|config|misconfigur/i,
    );
  });
});
