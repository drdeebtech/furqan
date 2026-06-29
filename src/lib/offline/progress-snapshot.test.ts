import { describe, it, expect, beforeEach } from "vitest";
import {
  PROGRESS_SNAPSHOT_KEY,
  writeProgressSnapshot,
  readProgressSnapshot,
  type OfflineProgressSnapshot,
} from "./progress-snapshot";

// Node test env (no jsdom) — stub a minimal localStorage like context.test.ts.
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
};
Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage, configurable: true });

const snapshot: OfflineProgressSnapshot = {
  syncedAt: "2026-06-29T12:00:00.000Z",
  currentLevel: "intermediate",
  assignments: [{ title: "البقرة", surah: 2, ayahStart: 1, ayahEnd: 5, dueDate: null, status: "assigned" }],
  recentProgress: [
    { surahFrom: 78, ayahFrom: 1, surahTo: 78, ayahTo: 20, type: "new", quality: 4, date: "2026-06-28T00:00:00.000Z" },
  ],
};

beforeEach(() => mockLocalStorage.clear());

describe("progress snapshot", () => {
  it("round-trips through localStorage", () => {
    writeProgressSnapshot(snapshot);
    expect(readProgressSnapshot()).toEqual(snapshot);
  });

  it("returns null when nothing is stored", () => {
    expect(readProgressSnapshot()).toBeNull();
  });

  it("returns null on corrupt JSON instead of throwing", () => {
    mockLocalStorage.setItem(PROGRESS_SNAPSHOT_KEY, "{not json");
    expect(readProgressSnapshot()).toBeNull();
  });

  it("returns null on a valid-JSON but wrong-shape snapshot (older format)", () => {
    // Missing the arrays the /offline UI maps over → must fall back to null,
    // not crash the reader. (#527 CR)
    mockLocalStorage.setItem(PROGRESS_SNAPSHOT_KEY, JSON.stringify({ syncedAt: "x", currentLevel: "beginner" }));
    expect(readProgressSnapshot()).toBeNull();
    mockLocalStorage.setItem(PROGRESS_SNAPSHOT_KEY, JSON.stringify({}));
    expect(readProgressSnapshot()).toBeNull();
  });

  it("does NOT persist teacher notes or parent reports (shared-device leak)", () => {
    writeProgressSnapshot(snapshot);
    const raw = mockLocalStorage.getItem(PROGRESS_SNAPSHOT_KEY) ?? "";
    expect(raw).not.toContain("teacherNotes");
    expect(raw).not.toContain("parentNote");
  });
});
