import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trust-boundary tripwire (issue #689).
 *
 * These helpers act on raw studentId/teacherId/recipient input with NO
 * authorization of their own — they rely on already-authorized server-side
 * callers. `"use server"` would turn each export into a client-invokable
 * server-action endpoint (a live IDOR / notification-spoofing RPC), so they
 * must stay plain server-only modules. `import "server-only"` makes any
 * client-side import chain a build error instead of an exposure.
 */
const UNGUARDED_INTERNAL_HELPERS = [
  "src/lib/reports/send-narrative.ts",
  "src/lib/notifications/parent.ts",
  "src/lib/notifications/dispatcher.ts",
];

describe("internal helper trust boundary (issue #689)", () => {
  for (const relPath of UNGUARDED_INTERNAL_HELPERS) {
    const source = readFileSync(join(process.cwd(), relPath), "utf8");

    it(`${relPath} is not a server action ("use server" absent)`, () => {
      expect(source).not.toMatch(/^\s*["']use server["']/m);
    });

    it(`${relPath} is poisoned against client imports (server-only)`, () => {
      expect(source).toMatch(/import ["']server-only["']/);
    });
  }
});
