import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/supabase.generated";
import { logError } from "@/lib/logger";

/**
 * Strip auth-token cookies whose value isn't a validly-shaped Supabase
 * session token. @supabase/ssr's session-construction throws (synchronously
 * inside an async callback that try/catch can't reach) when it sees a junk
 * value, surfacing as
 *   TypeError: Cannot create property 'user' on string '<value>'
 * in dev logs and a Sentry event in prod. Filtering at the edge means the
 * SDK never sees the bad cookie — it behaves as if the user is unauthenticated
 * and middleware redirects to /login normally. Found via k6 smoke probe
 * 2026-04-30. Split-cookie chunks (`<name>.0`, `<name>.1`, …) used for tokens
 * over 4KB are passed through untouched — only the *first* chunk is JSON-shape
 * checked, so a partial split set still works.
 */
function isValidAuthCookieValue(name: string, value: string): boolean {
  if (!name.startsWith("sb-") || !name.endsWith("-auth-token")) return true;
  if (!value) return false;
  // Real values are either JSON (`{...}`) or base64-encoded JSON (`base64-...`).
  // Split-cookie continuations (.0, .1, ...) come through with names that don't
  // match the suffix above, so we don't see them here.
  return value.startsWith("{") || value.startsWith("[") || value.startsWith("base64-");
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies
            .getAll()
            .filter(({ name, value }) => isValidAuthCookieValue(name, value));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Trigger token refresh — getUser() validates against Supabase Auth.
  // Do NOT use getSession() here — it reads from cookies without verification.
  //
  // Wrapped in try/catch because @supabase/ssr's session-construction throws
  // when the cookie value is malformed (e.g. raw "junk" or partially written
  // tokens left behind by an interrupted login). Surfaced by k6 smoke probing
  // 2026-04-30 — was producing
  //   TypeError: Cannot create property 'user' on string '<value>'
  // in dev (and a Sentry event in prod). Treat any throw as "no user", let
  // the existing middleware redirect-to-login path run as if there were no
  // cookie at all.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (err) {
    logError("supabase.auth.getUser threw — treating as unauthenticated", err, {
      tag: "auth-middleware",
      // info severity: malformed cookies are a normal failure mode (expired
      // sessions, tampered values, mid-flight logout) — not a system bug.
      severity: "info",
    });
  }

  return { supabaseResponse, user, supabase };
}
