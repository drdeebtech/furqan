import { describe, expect, it } from "vitest";
import type dns from "node:dns";
import { makeSafePushLookup, pinnedPushAgent } from "./safe-endpoint";

type LookupResult = dns.LookupAddress[];

function fakeResolver(answers: LookupResult | Error) {
  return ((_host: string, _opts: unknown, cb: (err: Error | null, addresses?: LookupResult) => void) => {
    if (answers instanceof Error) return cb(answers);
    cb(null, answers);
  }) as unknown as typeof dns.lookup;
}

function callLookup(
  lookup: ReturnType<typeof makeSafePushLookup>,
  host: string,
  opts: Record<string, unknown> = {},
): Promise<{ err: NodeJS.ErrnoException | null; address?: unknown; family?: unknown }> {
  return new Promise((resolve) => {
    lookup(host, opts, (err, address, family) => resolve({ err, address, family }));
  });
}

describe("makeSafePushLookup (issue #687 — connect-time DNS pin)", () => {
  it("returns the resolved address for a public answer", async () => {
    const lookup = makeSafePushLookup(fakeResolver([{ address: "142.250.180.10", family: 4 }]));

    const { err, address, family } = await callLookup(lookup, "fcm.googleapis.com");

    expect(err).toBeNull();
    expect(address).toBe("142.250.180.10");
    expect(family).toBe(4);
  });

  it("refuses to connect when the answer is private (rebinding at connect time)", async () => {
    const lookup = makeSafePushLookup(fakeResolver([{ address: "169.254.169.254", family: 4 }]));

    const { err } = await callLookup(lookup, "rebinder.example.com");

    expect(err).not.toBeNull();
    expect(err?.code).toBe("ERR_PUSH_UNSAFE_ADDRESS");
  });

  it("refuses when ANY answer in the set is private (dual-answer rebinding)", async () => {
    const lookup = makeSafePushLookup(
      fakeResolver([
        { address: "142.250.180.10", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ]),
    );

    const { err } = await callLookup(lookup, "rebinder.example.com");

    expect(err?.code).toBe("ERR_PUSH_UNSAFE_ADDRESS");
  });

  it("refuses an empty answer set", async () => {
    const lookup = makeSafePushLookup(fakeResolver([]));

    const { err } = await callLookup(lookup, "nxdomainish.example.com");

    expect(err?.code).toBe("ERR_PUSH_UNSAFE_ADDRESS");
  });

  it("propagates resolver errors", async () => {
    const boom = Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    const lookup = makeSafePushLookup(fakeResolver(boom));

    const { err } = await callLookup(lookup, "nxdomain.example.com");

    expect(err?.code).toBe("ENOTFOUND");
  });

  it("returns the full validated list when the caller asks for all", async () => {
    const answers: LookupResult = [
      { address: "142.250.180.10", family: 4 },
      { address: "2a00:1450:4009:81f::200a", family: 6 },
    ];
    const lookup = makeSafePushLookup(fakeResolver(answers));

    const { err, address } = await callLookup(lookup, "fcm.googleapis.com", { all: true });

    expect(err).toBeNull();
    expect(address).toEqual(answers);
  });
});

describe("pinnedPushAgent", () => {
  it("is an https agent wired to the safe lookup", () => {
    expect(pinnedPushAgent).toBeDefined();
    expect(pinnedPushAgent.options.lookup).toBeTypeOf("function");
  });
});
