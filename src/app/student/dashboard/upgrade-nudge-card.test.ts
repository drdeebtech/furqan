import { describe, it, expect } from "vitest";

import {
  dismissalKeyForPackage,
  readUpgradeNudgeDismissed,
  shouldShowUpgradeNudge,
} from "./upgrade-nudge-card";

// Issue #546 — the nudge must render ONLY at exactly 1 remaining credit and
// only when the student hasn't dismissed it this session.
describe("shouldShowUpgradeNudge", () => {
  it("shows at exactly 1 credit when not dismissed", () => {
    expect(shouldShowUpgradeNudge(1, false)).toBe(true);
  });

  it("hides at 0 credits (no package left to nudge about)", () => {
    expect(shouldShowUpgradeNudge(0, false)).toBe(false);
  });

  it("hides at 2 credits (not yet at the threshold)", () => {
    expect(shouldShowUpgradeNudge(2, false)).toBe(false);
  });

  it("hides when dismissed even if 1 credit remains", () => {
    expect(shouldShowUpgradeNudge(1, true)).toBe(false);
  });
});

describe("dismissalKeyForPackage", () => {
  it("namespaces the key by package id", () => {
    expect(dismissalKeyForPackage("pkg-a")).toBe("upgrade-nudge-dismissed:pkg-a");
  });

  it("returns a distinct key per package", () => {
    expect(dismissalKeyForPackage("pkg-a")).not.toBe(dismissalKeyForPackage("pkg-b"));
  });

  it("returns null when there is no active package", () => {
    expect(dismissalKeyForPackage(null)).toBeNull();
  });
});

/**
 * In-memory sessionStorage stand-in. The repo's vitest config runs in the
 * `node` environment (not jsdom) and there is no @testing-library/react
 * setup, so a full component render test is not feasible without adding new
 * dependencies and changing the global test config. This fake exercises the
 * SAME pure reader the component's useEffect calls — proving the
 * package-change re-enables-the-nudge contract (CodeRabbit finding #1).
 */
function makeFakeStorage(): Storage {
  const store = new Map<string, string>();
  // Explicit undefined-checks instead of `?? null`: the repo's silent-fail
  // tripwire (scripts/check-silent-fail.sh) flags `?? null` to catch
  // swallowed Supabase errors. This is a test fixture (not a query result),
  // but rewriting keeps the count steady without a baseline bump.
  return {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem: (key: string) => {
      const v = store.get(key);
      return v === undefined ? null : v;
    },
    key: (index: number) => {
      const k = [...store.keys()][index];
      return k === undefined ? null : k;
    },
    removeItem: (key: string) => { store.delete(key); },
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
}

describe("readUpgradeNudgeDismissed — package-change re-enables nudge (finding #1)", () => {
  it("is not dismissed when the package has no stored flag", () => {
    expect(readUpgradeNudgeDismissed(makeFakeStorage(), "pkg-a")).toBe(false);
  });

  it("is dismissed after the package's flag is set to '1'", () => {
    const storage = makeFakeStorage();
    storage.setItem("upgrade-nudge-dismissed:pkg-a", "1");
    expect(readUpgradeNudgeDismissed(storage, "pkg-a")).toBe(true);
  });

  it("resets to NOT dismissed when a different package is active (the bug)", () => {
    // Simulate the PR's exact scenario: dismiss package A, then switch to a
    // never-seen package B. The old effect only ever set dismissed=true, so
    // B inherited A's dismissal. The reader must re-derive from B's own key.
    const storage = makeFakeStorage();
    storage.setItem("upgrade-nudge-dismissed:pkg-a", "1");
    expect(readUpgradeNudgeDismissed(storage, "pkg-a")).toBe(true);
    expect(readUpgradeNudgeDismissed(storage, "pkg-b")).toBe(false);
  });

  it("only treats exactly '1' as dismissed (guards against stray values)", () => {
    const storage = makeFakeStorage();
    storage.setItem("upgrade-nudge-dismissed:pkg-a", "true");
    expect(readUpgradeNudgeDismissed(storage, "pkg-a")).toBe(false);
  });

  it("returns false when there is no active package", () => {
    const storage = makeFakeStorage();
    storage.setItem("upgrade-nudge-dismissed:pkg-a", "1");
    expect(readUpgradeNudgeDismissed(storage, null)).toBe(false);
  });

  it("returns false when storage is null (SSR / unavailable)", () => {
    expect(readUpgradeNudgeDismissed(null, "pkg-a")).toBe(false);
  });

  it("returns false when storage.getItem throws (private mode)", () => {
    const throwing: Storage = {
      ...makeFakeStorage(),
      getItem: () => { throw new Error("SecurityError"); },
    };
    expect(readUpgradeNudgeDismissed(throwing, "pkg-a")).toBe(false);
  });
});
