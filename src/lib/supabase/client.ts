import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase.generated";
import { createObservedFetch } from "./observability";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Sprint 1.1: every Supabase HTTP error gets reported to Sentry
      // via logError. Wrapper is observation-only — calling code's
      // `?? []` fallback still runs, behavior unchanged.
      global: { fetch: createObservedFetch() },
    },
  );
}
