import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Spec 022 / T027 — no-debit invariant.
 *
 * The defining invariant of this spec (NFR-001 / FR-007): the three
 * one-time-paid single-session products MUST NEVER debit `student_packages`
 * or call `deduct_package_session`. This test statically guarantees that
 * neither the new domain modules nor the new routes reference any
 * student_packages mutation primitive. It complements the runtime guarantee
 * in the DB (the adapted `start_instant_session_booking` only debits when
 * `p_payment_id IS NULL`; the atomic creator stamps NULL unconditionally).
 *
 * A static grep is the right tool here because the route/creator paths are
 * the only TS surface that could even attempt a debit. If any of these
 * files later grow a `deduct_package_session` call, this test fails loudly
 * before a credit can be silently consumed.
 */
describe("no-debit invariant (spec 022 / T027)", () => {
  const FILES_TO_AUDIT = [
    "src/lib/domains/single-sessions/specialist-matching.ts",
    "src/lib/domains/single-sessions/pricing.ts",
    "src/lib/domains/single-sessions/quran-validation.ts",
    "src/app/api/stripe/checkout/single-session/route.ts",
    "src/app/api/single-sessions/assessment-specialists/route.ts",
    "src/app/api/single-sessions/my-bookings/route.ts",
    "src/app/api/admin/single-sessions/prices/route.ts",
  ];

  it("no spec-022 file calls deduct_package_session or mutates student_packages", () => {
    const FORBIDDEN = [
      /\bdeduct_package_session\b/g,
      /\.from\(\s*["']student_packages["']\s*\)\s*\.(?:insert|update|delete|upsert)\b/g,
    ];

    const offenders: string[] = [];
    // CodeRabbit #5: collect missing files instead of silently continuing.
    // A rename or moved file would otherwise make the test pass vacuously,
    // masking coverage drift. Fail loudly if any audited file is missing.
    const missing: string[] = [];
    for (const rel of FILES_TO_AUDIT) {
      const abs = resolve(process.cwd(), rel);
      let src: string;
      try {
        src = readFileSync(abs, "utf8");
      } catch (e) {
        missing.push(`${rel}: ${(e as NodeJS.ErrnoException).message}`);
        continue;
      }
      for (const re of FORBIDDEN) {
        const matches = src.match(re);
        if (matches && matches.length > 0) {
          offenders.push(`${rel}: ${matches.length}× /${re.source}/`);
        }
      }
    }

    expect(
      missing,
      `No-debit invariant test could not find expected files (coverage drift):\n${missing.join("\n")}`,
    ).toEqual([]);
    expect(offenders, `Found forbidden debit/mutation references:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the atomic creator SQL stamps student_package_id = NULL on every path", () => {
    // CodeRabbit #5: validate the invariant across every migration that
    // (re)defines create_single_session_booking, not just the original.
    // A later migration could silently redefine the function and remove
    // the NULL stamp — this test catches that drift.
    const migrationDir = resolve(process.cwd(), "supabase/migrations");
    const migrationFiles = readdirSync(migrationDir)
      .filter((f) => /\.sql$/.test(f))
      .sort()
      .map((f) => join(migrationDir, f));

    expect(migrationFiles.length, "no migration files found").toBeGreaterThan(0);

    const creatorsDefiningNullStamp: string[] = [];
    const creatorsDefiningPkgId: string[] = [];
    for (const migrationFile of migrationFiles) {
      const sql = readFileSync(migrationFile, "utf8");
      // Find any CREATE OR REPLACE FUNCTION create_single_session_booking block.
      const fnRegex = /create\s+or\s+replace\s+function\s+public\.create_single_session_booking[\s\S]*?\n\$\$;/gi;
      let match: RegExpExecArray | null;
      while ((match = fnRegex.exec(sql)) !== null) {
        const body = match[0];
        // Track every definition so we can assert the list is non-empty.
        creatorsDefiningPkgId.push(migrationFile);
        // The body must explicitly stamp student_package_id as NULL in the
        // INSERT (the canonical "no debit" guarantee).
        if (/student_package_id[\s\S]*?null/i.test(body) || /p_student_id,\s*p_teacher_id,\s*null,/i.test(body)) {
          creatorsDefiningNullStamp.push(migrationFile);
        }
      }
    }

    expect(
      creatorsDefiningPkgId.length,
      "create_single_session_booking is not defined in any migration",
    ).toBeGreaterThan(0);
    expect(
      creatorsDefiningNullStamp.length,
      `create_single_session_booking is redefined in ${creatorsDefiningPkgId.length} migration(s) but NONE stamp student_package_id = NULL: ${creatorsDefiningPkgId.join(", ")}`,
    ).toBe(creatorsDefiningPkgId.length);
  });
});
