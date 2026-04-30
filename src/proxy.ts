import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { updateSession } from "@/lib/supabase/middleware";
import { setSentryUser } from "@/lib/sentry/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRoleTag } from "@/lib/auth/role-cache";
import type { UserRole } from "@/types/database";

/**
 * Per-user role cache, backed by Next's `unstable_cache` so it survives
 * across Fluid Compute instances and is invalidatable by tag. Server actions
 * that mutate `profiles.role` should call `invalidateRoleCache(userId)`
 * from `@/lib/auth/role-cache` to make the demoted/promoted role take
 * effect immediately. The 10-second TTL is a fallback in case some write
 * path forgets to invalidate — much tighter than the previous 60s window.
 */
const fetchRoleForUser = (userId: string) =>
  unstable_cache(
    async (): Promise<UserRole | null> => {
      // Admin client (no cookies()) — required because unstable_cache
      // disallows dynamic APIs inside the cached function body. Reading
      // a profile row by user_id is the same shape as `src/lib/settings.ts`.
      const supabase = createAdminClient();
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single<{ role: UserRole }>();
      return data?.role ?? null;
    },
    [`user-role`, userId],
    { tags: [buildRoleTag(userId)], revalidate: 10 },
  )();

// Map URL prefix → coarse domain tag for Sentry filtering.
function deriveDomain(pathname: string): string {
  const seg = pathname.split("/")[1] ?? "";
  if (!seg) return "public";
  if (seg === "admin" || seg === "moderator" || seg === "teacher" || seg === "student") return seg;
  if (seg === "api") return "api";
  if (seg === "login" || seg === "register" || seg === "forgot-password") return "auth";
  if (seg === "teach" || seg === "teachers-page") return "teachers";
  if (seg === "blog") return "blog";
  if (seg === "packages" || seg === "services") return "packages";
  return "public";
}

const PROTECTED_ROUTES: Record<string, UserRole> = {
  "/student": "student",
  "/teacher": "teacher",
  "/admin": "admin",
  "/moderator": "moderator",
};

const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password"];

async function getUserRole(
  _supabase: Awaited<ReturnType<typeof updateSession>>["supabase"],
  userId: string,
): Promise<UserRole | null> {
  // Delegates to the tagged unstable_cache above. The supabase param is
  // kept in the signature for backward compatibility but unused; the cached
  // implementation creates its own admin client.
  return fetchRoleForUser(userId);
}

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user, supabase } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Tag every Sentry event from this request with the authenticated user's id
  // and a coarse domain derived from the URL. Cheap — no DB hit.
  // Role is layered on below once we look it up.
  Sentry.setTag?.("domain", deriveDomain(pathname));
  if (user) {
    setSentryUser(user.id);
  }

  // Allow public routes and static assets
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    // Redirect authenticated users away from auth pages
    if (user) {
      const role = await getUserRole(supabase, user.id);
      if (role) {
        setSentryUser(user.id, role);
        const dashboard = role === "moderator" ? "/moderator/dashboard" : `/${role}/dashboard`;
        return NextResponse.redirect(new URL(dashboard, request.url));
      }
    }
    return supabaseResponse;
  }

  // Check protected routes
  for (const [prefix, requiredRole] of Object.entries(PROTECTED_ROUTES)) {
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;

    // Not authenticated → redirect to login
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Fetch user role
    const role = await getUserRole(supabase, user.id);

    // Refresh Sentry scope with the role for any errors in the handler below.
    setSentryUser(user.id, role);

    // Admin can access moderator routes. Log the bypass as a breadcrumb so
    // any error or audit-trail event captured later in this request shows
    // that an admin used moderator-scoped functionality. Cheap (no DB hit).
    if (prefix === "/moderator" && role === "admin") {
      Sentry.addBreadcrumb?.({
        category: "auth.admin-bypass",
        level: "info",
        message: `admin ${user.id} accessed moderator route ${pathname}`,
      });
      break;
    }

    if (role !== requiredRole) {
      // Wrong role → redirect to their own dashboard or login
      const home = role ? `/${role}/dashboard` : "/login";
      return NextResponse.redirect(new URL(home, request.url));
    }

    break;
  }

  // Authenticated user on root "/" → redirect to their dashboard
  if (pathname === "/" && user) {
    const role = await getUserRole(supabase, user.id);
    if (role) {
      return NextResponse.redirect(
        new URL(`/${role}/dashboard`, request.url),
      );
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/).*)",
  ],
};
