import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import type { UserRole } from "@/types/database";

const PROTECTED_ROUTES: Record<string, UserRole> = {
  "/student": "student",
  "/teacher": "teacher",
  "/admin": "admin",
  "/moderator": "moderator",
};

const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password"];

// Per-instance role cache. Fluid Compute reuses function instances across
// concurrent requests, so a typical browsing session of N pages collapses to
// 1 Postgres roundtrip + (N-1) cache hits. TTL is short enough that role
// changes (admin promotes user, etc.) propagate within a minute without
// requiring an explicit invalidation hook.
const ROLE_CACHE_TTL_MS = 60_000;
const roleCache = new Map<string, { role: UserRole | null; expiresAt: number }>();

async function getUserRole(
  supabase: Awaited<ReturnType<typeof updateSession>>["supabase"],
  userId: string,
): Promise<UserRole | null> {
  const now = Date.now();
  const cached = roleCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return cached.role;
  }

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single<{ role: UserRole }>();

  const role = data?.role ?? null;
  roleCache.set(userId, { role, expiresAt: now + ROLE_CACHE_TTL_MS });
  return role;
}

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user, supabase } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Allow public routes and static assets
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    // Redirect authenticated users away from auth pages
    if (user) {
      const role = await getUserRole(supabase, user.id);
      if (role) {
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

    // Admin can access moderator routes
    if (prefix === "/moderator" && role === "admin") {
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
