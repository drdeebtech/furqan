import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import type { UserRole } from "@/types/database";

const PROTECTED_ROUTES: Record<string, UserRole> = {
  "/student": "student",
  "/teacher": "teacher",
  "/admin": "admin",
};

const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password"];

async function getUserRole(
  supabase: Awaited<ReturnType<typeof updateSession>>["supabase"],
  userId: string,
): Promise<UserRole | null> {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single<{ role: UserRole }>();
  return data?.role ?? null;
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
        return NextResponse.redirect(
          new URL(`/${role}/dashboard`, request.url),
        );
      }
    }
    return supabaseResponse;
  }

  // Check protected routes
  for (const [prefix, requiredRole] of Object.entries(PROTECTED_ROUTES)) {
    if (!pathname.startsWith(prefix)) continue;

    // Not authenticated → redirect to login
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Fetch user role
    const role = await getUserRole(supabase, user.id);

    if (role !== requiredRole) {
      // Wrong role → redirect to their own dashboard or login
      const home = role ? `/${role}/dashboard` : "/login";
      return NextResponse.redirect(new URL(home, request.url));
    }

    break;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/).*)",
  ],
};
