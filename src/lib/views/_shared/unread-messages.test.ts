import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { unreadMessagesFilter } from "./unread-messages";

/**
 * Records every filter call on the chain so we can assert the exact
 * predicate applied — this is the corrected-predicate assertion the RED/GREEN
 * cycle hinges on: `hidden_at` must be filtered, `deleted_at` must not.
 */
function makeSpyChain() {
  const calls: { method: string; args: unknown[] }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = { calls };
  for (const m of ["select", "in", "neq", "eq", "is"]) {
    chain[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    });
  }
  return chain;
}

describe("unreadMessagesFilter", () => {
  let chain: ReturnType<typeof makeSpyChain>;
  let supabase: { from: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    chain = makeSpyChain();
    supabase = { from: vi.fn(() => chain) };
  });

  it("filters is_read=false, sender != userId, and hidden_at IS NULL", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unreadMessagesFilter(supabase as any, ["c1", "c2"], "user-1");

    expect(supabase.from).toHaveBeenCalledWith("messages");
    expect(chain.in).toHaveBeenCalledWith("conversation_id", ["c1", "c2"]);
    expect(chain.neq).toHaveBeenCalledWith("sender_id", "user-1");
    expect(chain.eq).toHaveBeenCalledWith("is_read", false);
    // The corrected predicate: excludes moderator-hidden messages.
    expect(chain.is).toHaveBeenCalledWith("hidden_at", null);
  });

  it("never filters the dead deleted_at column (negative control)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unreadMessagesFilter(supabase as any, ["c1"], "user-1");

    const deletedAtCalls = chain.calls.filter(
      (c: { method: string; args: unknown[] }) => c.method === "is" && c.args[0] === "deleted_at"
    );
    expect(deletedAtCalls).toHaveLength(0);
  });
});
