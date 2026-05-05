import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/supabase.generated";
import { createObservedFetch } from "./observability";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll can fail when called from a Server Component.
            // This is safe to ignore if you have the proxy client
            // refreshing sessions.
          }
        },
      },
      // Sprint 1.1: every Supabase HTTP error gets reported to Sentry
      // via logError. Wrapper is observation-only — calling code's
      // `?? []` fallback still runs, behavior unchanged.
      global: { fetch: createObservedFetch() },
    },
  );
}
