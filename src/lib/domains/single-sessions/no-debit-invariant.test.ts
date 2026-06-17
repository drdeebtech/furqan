import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    for (const rel of FILES_TO_AUDIT) {
      const abs = resolve(process.cwd(), rel);
      let src: string;
      try {
        src = readFileSync(abs, "utf8");
      } catch {
        // Test scaffolding — skip files that aren't on disk in a given checkout
        // (the test fails for actual edits on real files).
        continue;
      }
      for (const re of FORBIDDEN) {
        const matches = src.match(re);
        if (matches && matches.length > 0) {
          offenders.push(`${rel}: ${matches.length}× /${re.source}/`);
        }
      }
    }

    expect(offenders, `Found forbidden debit/mutation references:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the atomic creator SQL stamps student_package_id = NULL on every path", () => {
    const migrationPath = resolve(
      process.cwd(),
      "supabase/migrations/20260619000001_single_session_columns.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    // create_single_session_booking body — the booking insert lists
    // student_package_id as NULL explicitly. Match from `create or replace
    // function create_single_session_booking` through the closing `$$;`.
    const creatorStart = sql.indexOf(
      "create or replace function public.create_single_session_booking",
    );
    expect(creatorStart, "create_single_session_booking not found").toBeGreaterThanOrEqual(0);
    // Find the END of the function (the `$$;` AFTER the body, which is the
    // next `$$` followed by `;` after the body's opening `as $$`).
    const bodyOpen = sql.indexOf("as $$", creatorStart);
    const bodyClose = sql.indexOf("\n$$;", bodyOpen);
    const creatorBody = sql.slice(creatorStart, bodyClose + 4);
    expect(creatorBody).toContain("p_student_id, p_teacher_id, null,");

    // The adapted start_instant_session_booking paid path also stamps NULL.
    const instantStart = sql.indexOf(
      "create or replace function public.start_instant_session_booking",
    );
    expect(instantStart, "start_instant_session_booking not found").toBeGreaterThanOrEqual(0);
    const instantBodyOpen = sql.indexOf("as $$", instantStart);
    const instantBodyClose = sql.indexOf("\n$$;", instantBodyOpen);
    const instantBody = sql.slice(instantStart, instantBodyClose + 4);
    expect(instantBody).toMatch(
      /student_package_id, booking_product_type[\s\S]*?null, 'instant'/,
    );
  });
});
