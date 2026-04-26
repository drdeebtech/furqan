/**
 * RLS regression tests — proves that anonymous (un-authenticated) clients
 * CANNOT read data they shouldn't. If a future schema change accidentally
 * weakens an RLS policy, these tests fail in CI.
 *
 * Strategy: hit the production DB with the public anon key (the same key
 * a website visitor would use from a browser) and assert the result is
 * empty / forbidden for every sensitive table.
 *
 * Skipped automatically if NEXT_PUBLIC_SUPABASE_URL or _ANON_KEY are not
 * set — local dev without those vars won't fail the suite.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const skip = !url || !anonKey;

let anon: SupabaseClient;
beforeAll(() => {
  if (!skip) anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
});

describe.skipIf(skip)("RLS regression — anonymous reads", () => {
  // Tables anonymous SHOULD be able to read (whitelist of public-by-design).
  it("can read public site_announcements that are active", async () => {
    const { data, error } = await anon.from("site_announcements").select("id");
    // Whatever shape — it must NOT throw a 'permission denied' style error.
    expect(error?.code).not.toBe("42501");
    expect(Array.isArray(data) || data === null).toBe(true);
  });

  it("can read approved teacher_profiles for the public listing", async () => {
    const { data, error } = await anon
      .from("teacher_profiles")
      .select("teacher_id")
      .eq("cv_status", "approved")
      .eq("is_archived", false)
      .eq("is_accepting", true);
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });

  // Tables anonymous MUST NOT read freely.
  const lockedTables = [
    "audit_log",
    "automation_logs",
    "automation_dead_letter",
    "communication_preferences",
    "homework_assignments",
    "message_delivery_log",
    "messages",
    "notifications",
    "parent_reports",
    "payments",
    "payment_transactions",
    "platform_settings",
    "retention_signals",
    "session_evaluations",
    "session_notes_history",
    "session_observers",
    "session_presence_events",
    "student_credits",
    "student_packages",
    "student_progress",
    "recitation_errors",
  ] as const;

  for (const table of lockedTables) {
    it(`anon cannot read ${table}`, async () => {
      const { data, error: _error } = await anon.from(table).select("*").limit(1);
      // Either RLS denies (data is empty) or Postgres throws permission denied.
      // Both are acceptable; what's NOT acceptable is real rows leaking out.
      if (data && data.length > 0) {
        throw new Error(
          `RLS regression: anonymous client read ${data.length} row(s) from ${table}. Expected zero or permission denied. First row keys: ${Object.keys(data[0]).join(", ")}`,
        );
      }
      // error is OK (means RLS denies the SELECT). null error + empty array is also OK.
      // Only the "got rows" case fails the assertion above.
      expect(true).toBe(true); // explicit pass for vitest
    });
  }

  // Pending teachers must not appear on the public listing.
  it("pending_review teacher_profiles are not visible to anon", async () => {
    const { data } = await anon
      .from("teacher_profiles")
      .select("teacher_id")
      .neq("cv_status", "approved");
    expect(data ?? []).toEqual([]);
  });
});
