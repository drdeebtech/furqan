/**
 * Spec 040 FR-006 parity gate — proves the TypeScript earning rule and its SQL
 * twin agree cent-for-cent, and documents the bounded difference against the
 * legacy monthly payroll formula.
 *
 * Runs the ACTUAL deriveEarningCents (not a copy) against connect_earning_cents
 * evaluated in Postgres over a wide grid. No `pg` dependency: it shells out to
 * psql, exactly like the SQL walks.
 *
 * Run (needs a local DB with the 20260729 migration applied):
 *   LOCAL_DB_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/parity-040-earning-cents.ts
 *
 * Exit 0 = JS and SQL agree everywhere and the legacy gap is within bound.
 * Any mismatch prints the offending (duration, rate) triple and exits 1.
 */
import { execFileSync } from "node:child_process";

import { deriveEarningCents } from "../src/lib/domains/connect/earnings";

const DB_URL =
  process.env.LOCAL_DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";

// 2-decimal rates (what numeric(10,2) can hold), including the float-hostile
// ones (0.07, 29.99, 33.33) and boundaries (0.01, min; 150.00, a high rate).
const RATES = [0.01, 0.07, 0.1, 0.25, 1, 12.5, 20, 25, 29.99, 33.33, 99.99, 150] as const;
// Durations spanning typical sessions plus awkward remainders mod 60.
const DURATIONS = [1, 3, 7, 9, 15, 25, 30, 37, 45, 59, 60, 61, 90, 119, 120] as const;

function psqlRows(sql: string): string[] {
  const out = execFileSync("psql", [DB_URL, "-t", "-A", "-F", ",", "-c", sql], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function runGridParity(): number {
  // One query returns (duration, rate, sql_cents) for the whole grid.
  const values = DURATIONS.flatMap((d) => RATES.map((r) => `(${d}, ${r.toFixed(2)})`)).join(
    ", ",
  );
  const rows = psqlRows(
    `SELECT d, r, connect_earning_cents(d, r) FROM (VALUES ${values}) AS g(d, r) ORDER BY d, r;`,
  );

  let checked = 0;
  let mismatches = 0;
  for (const line of rows) {
    const [dStr, rStr, sqlStr] = line.split(",");
    const durationMinutes = Number(dStr);
    const hourlyRateUsd = Number(rStr);
    const sqlCents = Number(sqlStr);
    const jsCents = deriveEarningCents({ durationMinutes, hourlyRateUsd });
    checked += 1;
    if (jsCents !== sqlCents) {
      mismatches += 1;
      console.error(
        `  MISMATCH  ${durationMinutes}min @ $${hourlyRateUsd}: JS=${jsCents} SQL=${sqlCents}`,
      );
    }
  }
  console.log(
    `  grid parity: ${checked - mismatches}/${checked} agree (${DURATIONS.length}×${RATES.length})`,
  );
  return mismatches;
}

// Legacy payroll (20260619000004_attendance_payroll_fns.sql) computes a MONTHLY
// float sum rounded once: ROUND(SUM(duration/60.0 * rate), 2). The new rule is
// per-delivery integer round-half-up, so the two CANNOT be bit-identical — the
// gap is pure per-delivery rounding. This asserts that gap stays within a tight,
// documented bound rather than pretending a false equality.
function runLegacyBoundedDifference(): number {
  const rate = 20; // uniform rate (non-uniform is a payroll exception, not compared)
  const monthDurations = [30, 45, 25, 55, 15, 37, 50, 20, 40, 33];

  const newTotalCents = monthDurations.reduce(
    (sum, d) => sum + deriveEarningCents({ durationMinutes: d, hourlyRateUsd: rate }),
    0,
  );
  const legacyDollars =
    Math.round(monthDurations.reduce((s, d) => s + (d / 60) * rate, 0) * 100) / 100;
  const legacyCents = Math.round(legacyDollars * 100);

  // Each of N deliveries rounds by at most 0.5¢; the legacy single rounding adds
  // at most another 0.5¢. |diff| <= N is a safe, generous ceiling.
  const diff = Math.abs(newTotalCents - legacyCents);
  const bound = monthDurations.length;
  const ok = diff <= bound;
  console.log(
    `  legacy bounded-difference: new=${newTotalCents}¢ legacy=${legacyCents}¢ ` +
      `|diff|=${diff}¢ <= ${bound}¢ ... ${ok ? "OK" : "OUT OF BOUND"}`,
  );
  return ok ? 0 : 1;
}

function main(): void {
  console.log("=== Spec 040 FR-006 parity: TypeScript deriveEarningCents vs SQL connect_earning_cents ===");
  const gridMismatches = runGridParity();
  const legacyFailures = runLegacyBoundedDifference();

  if (gridMismatches > 0 || legacyFailures > 0) {
    console.error(`\nPARITY FAILED: ${gridMismatches} grid mismatch(es), ${legacyFailures} legacy failure(s).`);
    process.exit(1);
  }
  console.log("\nPARITY OK: JS and SQL agree on every grid point; legacy gap within bound.");
}

main();
