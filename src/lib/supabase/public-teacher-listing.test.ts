/**
 * Integration regression — spec 035 US1 / contracts/public-teacher-listing.md.
 *
 * Proves the public teacher listing is DEFAULT-DENY against test/seed accounts:
 *   INV-1/2  a seeded @furqan.test teacher is flagged `is_test_account = true`
 *            (the migration backfill) and therefore excluded by the public
 *            profile gate (`role = 'teacher' AND is_test_account = false`).
 *   INV-3/4  the all-surface demotion archives their teacher_profiles, so the
 *            shared `is_archived = false AND is_accepting = true AND
 *            cv_status = 'approved'` gate (used by every teacher-listing
 *            surface) also excludes them — no per-surface code needed.
 *
 * Hits the local Supabase with the service-role key (read-only here). Skipped
 * automatically when the SUPABASE env or the local seed is absent (e.g. CI
 * without a DB), matching the pattern in src/lib/supabase/rls.test.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !serviceKey;

// Fixed UUIDs planted by scripts/seed_local_dev.sql (the @furqan.test teachers).
const SEED_TEACHER_IDS = [
  "11111111-0000-4000-8000-000000000001",
  "11111111-0000-4000-8000-000000000002",
  "11111111-0000-4000-8000-000000000003",
];

let admin: SupabaseClient<Database>;
let seeded = false;

beforeAll(async () => {
  if (skip) return;
  admin = createClient<Database>(url!, serviceKey!, { auth: { persistSession: false } });
  const { data } = await admin.from("profiles").select("id").in("id", SEED_TEACHER_IDS);
  // Verify all 3 seed teachers exist (not just some).
  seeded = (data?.length ?? 0) === SEED_TEACHER_IDS.length;
});

describe.skipIf(skip)("public teacher listing — default-deny against test accounts", () => {
  it("flags the seeded @furqan.test teachers as test accounts (backfill, INV-2)", async (ctx) => {
    if (!seeded) return ctx.skip();
    const { data, error } = await admin
      .from("profiles")
      .select("id, is_test_account")
      .in("id", SEED_TEACHER_IDS);
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(row.is_test_account).toBe(true);
    }
  });

  it("the public profile gate excludes every test-flagged teacher (INV-1/3)", async (ctx) => {
    if (!seeded) return ctx.skip();
    // This mirrors getPublicTeachers()' profiles step: role=teacher + the new
    // is_test_account=false predicate. No seed teacher may survive it.
    const { data, error } = await admin
      .from("profiles")
      .select("id")
      .eq("role", "teacher")
      .eq("is_test_account", false)
      .in("id", SEED_TEACHER_IDS);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("demotes the test accounts' teacher_profiles so the shared gate excludes them everywhere (INV-4)", async (ctx) => {
    if (!seeded) return ctx.skip();
    // The shared teacher_profiles gate used by all listing surfaces.
    const { data, error } = await admin
      .from("teacher_profiles")
      .select("teacher_id")
      .eq("is_archived", false)
      .eq("is_accepting", true)
      .eq("cv_status", "approved")
      .in("teacher_id", SEED_TEACHER_IDS);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
