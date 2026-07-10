/**
 * Unit tests for `resolveReceiptUrls` — best-effort Stripe receipt lookup.
 *
 * Pre-test verification (per common/testing.md):
 *  - Pure async; the ONLY external call is `stripe.paymentIntents.retrieve`,
 *    which we inject as a fake. No real Stripe, no network.
 *  - Core property under test: one PI's failure must NOT drop the others
 *    (best-effort isolation), and non-PI / string-charge / no-charge cases
 *    resolve to null rather than throwing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { resolveReceiptUrls } from "./receipt-urls";
import type { Stripe } from "@/lib/stripe/client";
import { logError } from "@/lib/logger";

/** Fake Stripe whose retrieve() is driven by a per-id script. */
function makeStripe(
  script: Record<string, "ok" | "throw" | "nocharge" | "stringcharge">,
) {
  const retrieve = vi.fn(async (id: string) => {
    const mode = script[id];
    if (mode === "throw") throw new Error(`stripe down for ${id}`);
    if (mode === "nocharge") return { id, latest_charge: null };
    if (mode === "stringcharge") return { id, latest_charge: "ch_unexpanded" };
    return { id, latest_charge: { id: "ch_x", receipt_url: `https://receipt/${id}` } };
  });
  return { paymentIntents: { retrieve } } as unknown as Stripe;
}

beforeEach(() => vi.clearAllMocks());

describe("resolveReceiptUrls", () => {
  it("resolves receipt urls and isolates a failing PI to null", async () => {
    const stripe = makeStripe({ pi_ok: "ok", pi_bad: "throw" });

    const map = await resolveReceiptUrls(stripe, ["pi_ok", "pi_bad"]);

    expect(map.get("pi_ok")).toBe("https://receipt/pi_ok");
    expect(map.get("pi_bad")).toBeNull();
    expect(map.size).toBe(2);
    // The failure is logged, not swallowed silently.
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("skips null/blank ids and de-duplicates", async () => {
    const stripe = makeStripe({ pi_ok: "ok" });

    const map = await resolveReceiptUrls(stripe, ["pi_ok", null, "", "pi_ok"]);

    expect(map.size).toBe(1);
    expect(map.get("pi_ok")).toBe("https://receipt/pi_ok");
    // retrieve called once despite the duplicate id.
    expect((stripe.paymentIntents.retrieve as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("returns null when the PI has no charge or an unexpanded (string) charge", async () => {
    const stripe = makeStripe({ pi_none: "nocharge", pi_str: "stringcharge" });

    const map = await resolveReceiptUrls(stripe, ["pi_none", "pi_str"]);

    expect(map.get("pi_none")).toBeNull();
    expect(map.get("pi_str")).toBeNull();
  });

  it("resolves every id across multiple concurrency batches (tail not dropped)", async () => {
    // 10 ids > the concurrency bound (8), so this spans two batches.
    const ids = Array.from({ length: 10 }, (_, i) => `pi_${i}`);
    const stripe = makeStripe(Object.fromEntries(ids.map((id) => [id, "ok" as const])));

    const map = await resolveReceiptUrls(stripe, ids);

    expect(map.size).toBe(10);
    for (const id of ids) expect(map.get(id)).toBe(`https://receipt/${id}`);
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(10);
  });

  it("returns an empty map for an empty input", async () => {
    const stripe = makeStripe({});
    const map = await resolveReceiptUrls(stripe, []);
    expect(map.size).toBe(0);
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});
