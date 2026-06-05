import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { createObservedFetch } from "./observability";

/**
 * Service-role Supabase client for admin operations (e.g. creating users from scratch).
 * Server-only — no cookies, bypasses RLS.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL");
  }

  // Block service-role writes against a remote database in the test runner.
  // The service-role key bypasses RLS, so an accidental call from a test
  // would mutate the real shared database — including production.
  // Local Supabase stack (localhost / 127.0.0.1) is always safe.
  // Set SUPABASE_ALLOW_PROD_IN_TESTS=true only for intentional network tests.
  if (
    process.env.NODE_ENV === "test" &&
    !process.env.SUPABASE_ALLOW_PROD_IN_TESTS &&
    !/localhost|127\.0\.0\.1/.test(url)
  ) {
    throw new Error(
      "[furqan] createAdminClient() blocked: remote Supabase URL in test mode.\n" +
      "Service-role calls bypass RLS — writes would mutate the real database.\n\n" +
      "Fix options (pick one):\n" +
      "  1. Mock createAdminClient in your test (preferred for unit tests)\n" +
      "  2. Run local stack: supabase start  →  NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321\n" +
      "  3. Use a separate dev Supabase project — see docs/guides/dev-environment.md\n\n" +
      "To intentionally bypass (read-only RLS tests only): SUPABASE_ALLOW_PROD_IN_TESTS=true",
    );
  }

  return createSupabaseClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // Sprint 1.1: same silent-fail observability as the regular client.
    // Service-role calls are typically the load-bearing ones (n8n callbacks,
    // bulk admin ops); a silent 4xx here is even more dangerous.
    global: { fetch: createObservedFetch() },
  });
}
