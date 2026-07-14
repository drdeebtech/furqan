import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/supabase.generated";
import { logError } from "@/lib/logger";
import { withTimeout } from "@/lib/promise-utils";

// Hard cap on how long supabase.auth.getUser() can take in middleware. Every
// request to a protected route blocks on this — a hang here freezes the
// browser tab spinner BEFORE the layout's loading.tsx ever has a chance to
// render. Healthy round-trip is 50–300ms; 3s is well outside the noise.
const MIDDLEWARE_AUTH_TIMEOUT_MS = 3000;

/**
 * Strip auth-token cookies whose value isn't a validly-shaped *and unexpired*
 * Supabase session token. @supabase/ssr's session-construction throws
 * (synchronously inside an async callback that try/catch can't reach) when
 * it sees a junk value, surfacing as
 *   TypeError: Cannot create property 'user' on string '<value>'
 * in dev logs and a Sentry event in prod. Filtering at the edge means the
 * SDK never sees the bad cookie — it behaves as if the user is unauthenticated
 * and middleware redirects to /login normally. Found via k6 smoke probe
 * 2026-04-30. Split-cookie chunks (`<name>.0`, `<name>.1`, …) used for tokens
 * over 4KB are passed through untouched — only the *first* chunk is JSON-shape
 * checked, so a partial split set still works.
 *
 * Beyond shape, this also rejects sessions whose `expires_at` is in the past.
 * Without that check, an expired token passes the filter, the SDK accepts it,
 * `getUser()` returns null silently, and downstream pages render against a
 * null user — a class of bug nobody catches until a Sentry NPE shows up.
 */
function isValidAuthCookieValue(name: string, value: string): boolean {
  if (!name.startsWith("sb-") || !name.endsWith("-auth-token")) return true;
  if (!value) return false;

  // Real values are either JSON (`{...}`) or base64-encoded JSON (`base64-...`).
  // Anything else is junk — filter it out.
  let payload: string;
  if (value.startsWith("base64-")) {
    try {
      // Buffer is available in Node runtime which is the default for
      // Next.js middleware as of 16. atob is the polyfill-friendly fallback.
      const encoded = value.slice("base64-".length);
      payload = typeof Buffer !== "undefined"
        ? Buffer.from(encoded, "base64").toString("utf-8")
        : atob(encoded);
    } catch {
      return false;
    }
  } else if (value.startsWith("{") || value.startsWith("[")) {
    payload = value;
  } else {
    return false;
  }

  let session: { expires_at?: number } | null = null;
  try {
    session = JSON.parse(payload);
  } catch {
    return false;
  }
  if (!session || typeof session !== "object") return false;

  // expires_at is a Unix epoch second. If it's missing we accept (some shapes
  // don't carry it pre-refresh); if it's clearly in the past we reject.
  // 30s grace covers clock skew and natural request latency.
  if (typeof session.expires_at === "number") {
    const nowSec = Math.floor(Date.now() / 1000);
    if (session.expires_at < nowSec - 30) return false;
  }

  return true;
}

export async function updateSession(request: NextRequest, cspNonce?: string) {
  const mergedRequestHeaders = new Headers(request.headers);
  if (cspNonce) mergedRequestHeaders.set("x-nonce", cspNonce);

  let supabaseResponse = NextResponse.next({
    request: { headers: mergedRequestHeaders },
  });

  // Forward the nonce to response headers so layout components can read it
  // via Next.js headers(). Setting it only on request headers makes it
  // available to Server Components during this render cycle, but headers()
  // reads from the *response* headers that Next.js exposes — so we must
  // copy it there as well.
  if (cspNonce) supabaseResponse.headers.set("x-nonce", cspNonce);

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
            request: { headers: mergedRequestHeaders },
          });
          // Re-apply the nonce to the new response object created in setAll.
          if (cspNonce) supabaseResponse.headers.set("x-nonce", cspNonce);
          cookiesToSet.forEach(({ name, value, options }) =>
            // SameSite=Lax: blocks CSRF on cross-site POST while still sending
            // the cookie on the top-level GET OAuth callback (Strict would drop
            // the PKCE code-verifier on Google's redirect and break login).
            supabaseResponse.cookies.set(name, value, { ...options, sameSite: "lax" }),
          );
        },
      },
    },
  );

  // Trigger token refresh — getUser() validates against Supabase Auth.
  // Do NOT use getSession() here — it reads from cookies without verification.
  //
  // Wrapped in BOTH try/catch and withTimeout:
  //   try/catch  — @supabase/ssr's session-construction throws when the
  //                cookie value is malformed (e.g. raw "junk" or partially
  //                written tokens left behind by an interrupted login).
  //                Surfaced by k6 smoke probing 2026-04-30 — was producing
  //                TypeError: Cannot create property 'user' on string …
  //   withTimeout — the previous catch only caught synchronous-ish throws.
  //                Some session shapes (token refresh against a slow / down
  //                Supabase Auth) can HANG for the full Vercel function
  //                timeout. Incident 2026-05-04 had every protected-route
  //                request stuck at the browser tab spinner because the
  //                middleware's getUser() never returned. On timeout we
  //                treat the request as unauthenticated and let the
  //                downstream redirect-to-login path run.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const result = await withTimeout(
      supabase.auth.getUser(),
      MIDDLEWARE_AUTH_TIMEOUT_MS,
      { data: { user: null }, error: null } as unknown as Awaited<
        ReturnType<typeof supabase.auth.getUser>
      >,
      "middleware.auth.getUser",
    );
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
