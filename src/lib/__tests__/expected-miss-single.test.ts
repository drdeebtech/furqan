/**
 * Regression guard — Sentry FURQAN-4J / 4G / 4B.
 *
 * ROOT CAUSE these lock in: PostgREST's `.single()` returns **HTTP 406** with a
 * `PGRST116 "The result contains 0 rows"` body when nothing matches. That is not
 * a crash — supabase-js returns `{data: null, error}` and the call sites below
 * already handle the null. But `createObservedFetch`
 * (src/lib/supabase/observability.ts) forwards EVERY non-2xx PostgREST response
 * to `logError()` → Sentry. So a `.single()` on a lookup that is *expected* to
 * miss manufactures a Sentry error on a perfectly normal code path.
 *
 * Concretely: a bot probing `/blog/wp-login.php` and an admin enabling a feature
 * flag for the first time each produced a Sentry issue. `.maybeSingle()` returns
 * HTTP 200 with `data: null` — same handling, no false alarm.
 *
 * This is a STATIC guard, not a behavioural test: these are Next.js server
 * components / server actions whose behaviour needs the full framework runtime
 * (the same reason src/app/** is excluded from coverage in vitest.config.ts).
 * The property worth locking is "this specific lookup can miss, so it must not
 * use .single()" — which is exactly what the source text encodes.
 *
 * NOT a blanket ban: 294 `.single()` call sites exist and most are correct —
 * where a row MUST exist, a 406 reaching Sentry is the wrapper doing its job.
 * Only lookups whose miss is a normal outcome belong here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Lookups where zero rows is a legitimate, expected outcome. */
const EXPECTED_MISS_SITES = [
  {
    file: "src/app/(public)/blog/[slug]/page.tsx",
    why: "unknown slug — bots probe /blog/wp-login.php (FURQAN-4G/4B)",
  },
  {
    file: "src/app/admin/settings/actions.ts",
    why: "flag has no row until an admin first enables it (FURQAN-4J)",
  },
] as const;

describe("expected-miss lookups must not use .single()", () => {
  for (const { file, why } of EXPECTED_MISS_SITES) {
    it(`${file} uses maybeSingle — ${why}`, () => {
      const src = readFileSync(resolve(ROOT, file), "utf8");

      // Scan CODE only. Comment lines are skipped because the fixes themselves
      // explain why `.single()` was wrong — without this the guard flags its own
      // rationale (caught while proving this test fails without the fix).
      const offenders = src
        .split("\n")
        .map((line, i) => ({ line: line.trim(), no: i + 1 }))
        .filter(({ line }) => !(line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")))
        // `.single<` / `.single()` but never the `.maybeSingle` suffix form.
        .filter(({ line }) => /(?<!maybe)\.single\s*[<(]/i.test(line));

      expect(
        offenders,
        `${file} still calls .single() at line(s) ${offenders
          .map((o) => o.no)
          .join(", ")}. A miss here is expected (${why}), so .single() returns ` +
          "HTTP 406 and createObservedFetch reports it to Sentry as an error. " +
          "Use .maybeSingle() — it returns 200 with data: null.",
      ).toEqual([]);

      // Positive assertion: the lookup still exists and is the safe variant.
      expect(src).toMatch(/\.maybeSingle\s*[<(]/);
    });
  }
});

/**
 * Regression guard — Sentry FURQAN-42 (and likely 46 / 43 on the same route).
 *
 * ROOT CAUSE: `sessions` and `bookings` are related by TWO foreign keys —
 * `bookings.session_id -> sessions.id` (one-to-many) and
 * `sessions.booking_id -> bookings.id` (one-to-one). An unqualified
 * `bookings!inner(...)` embed gives PostgREST no way to choose, so it refuses
 * with PGRST201 and the whole query 400s. On /student/progress that silently
 * broke the total-study-hours widget.
 *
 * The fix is an explicit FK hint: `bookings!sessions_booking_id_fkey!inner(...)`.
 * src/lib/views/admin-analytics.ts already did this (and documents why); the
 * student-progress query had not been updated to match.
 */
describe("sessions<->bookings embeds must name the foreign key", () => {
  it("no unqualified bookings!inner / sessions!inner anywhere in src/", () => {
    // Walk the tree without shelling out, so the guard works in any CI sandbox.

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;
        readFileSync(full, "utf8").split("\n").forEach((raw, i) => {
          const line = raw.trim();
          // Skip comments — admin-analytics.ts documents this rule in prose.
          if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) return;
          if (/\b(bookings|sessions)!inner\b/.test(line)) {
            offenders.push(`${full.replace(ROOT + "/", "")}:${i + 1}`);
          }
        });
      }
    };
    walk(resolve(ROOT, "src"));

    expect(
      offenders,
      `Unqualified sessions<->bookings embed at ${offenders.join(", ")}. Two FKs ` +
        "relate these tables, so PostgREST returns PGRST201 and the query 400s. " +
        "Name the FK, e.g. bookings!sessions_booking_id_fkey!inner(...).",
    ).toEqual([]);
  });
});
