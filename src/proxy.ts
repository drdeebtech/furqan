import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { updateSession } from "@/lib/supabase/middleware";
import { setSentryUser } from "@/lib/sentry/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRoleTag, type RoleState } from "@/lib/auth/role-cache";
import { withTimeout } from "@/lib/promise-utils";
import type { UserRole } from "@/types/database";
import { buildContentSecurityPolicy } from "@/lib/csp";

// Per-request timeout for the role-state lookup (Supabase admin query, cached
// via unstable_cache). Hangs here block every protected-route request before
// the layout's loading.tsx can render. On timeout we treat the user as having
// no role state — the existing fallback already redirects to /login. 3s is
// well above any healthy lookup (~30ms cached / ~100ms cold) and well below
// the layout/page timeouts so we fail fast at the upstream-most boundary.
const ROLE_STATE_TIMEOUT_MS = 3000;

/**
 * Per-user role-state cache, backed by Next's `unstable_cache` so it
 * survives across Fluid Compute instances and is invalidatable by tag.
 * Returns the *active* role plus the user's full `roles[]` set so the
 * route gate can both (a) check whether to allow the request and (b) know
 * what dashboard to bounce them to if the active role doesn't match.
 *
 * Server actions that mutate `profiles.role` or `profiles.roles` should
 * call `invalidateRoleCache(userId)` from `@/lib/auth/role-cache` so the
 * change lands on the user's very next request — the 10-second TTL is the
 * fallback safety net.
 */
const fetchRoleStateForUser = (userId: string) =>
  unstable_cache(
    async (): Promise<RoleState | null> => {
      const supabase = createAdminClient();
      // First try the new shape (multi-role). If the `roles` column doesn't
      // exist yet — Supabase Branching applies migrations asynchronously
      // after the deploy, so there's a window where the new code is live
      // but the column isn't — Postgres returns an error. We fall back to
      // a legacy single-role read so login is NEVER blocked by the
      // schema-vs-code race. Same fallback covers any transient cluster
      // blip on the new column too.
      const { data, error } = await supabase
        .from("profiles")
        .select("role, roles")
        .eq("id", userId)
        .single<{ role: UserRole; roles: UserRole[] | null }>();

      if (error) {
        const { data: legacy } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single<{ role: UserRole }>();
        if (!legacy?.role) return null;
        return { active: legacy.role, roles: [legacy.role] };
      }
      if (!data?.role) return null;
      return { active: data.role, roles: data.roles ?? [data.role] };
    },
    [`user-role`, userId],
    { tags: [buildRoleTag(userId)], revalidate: 10 },
  )();

// Map URL prefix → coarse domain tag for Sentry filtering.
function deriveDomain(pathname: string): string {
  const seg = pathname.split("/")[1] ?? "";
  if (!seg) return "public";
  if (seg === "admin" || seg === "teacher" || seg === "student") return seg;
  if (seg === "api") return "api";
  if (seg === "login" || seg === "register" || seg === "forgot-password") return "auth";
  if (seg === "teach-with-us" || seg === "teachers") return "teachers";
  if (seg === "blog") return "blog";
  if (seg === "packages" || seg === "services") return "packages";
  return "public";
}

const PROTECTED_ROUTES: Record<string, UserRole> = {
  "/student": "student",
  "/teacher": "teacher",
  "/admin": "admin",
};

const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password"];

// Legacy URL renames. These pages were renamed from "homework" to "follow-up"
// in the dashboards (the user-facing concept is closer to a continuity loop
// than to a one-off chore). Keep 301 redirects so any cached link, pasted
// URL, or in-flight n8n notification still lands the user on the right page.
const RENAMED_ROUTES: Array<readonly [from: string, to: string]> = [
  ["/teacher/homework", "/teacher/follow-up"],
  ["/student/homework", "/student/follow-up"],
  ["/admin/homework", "/admin/follow-up/grade"],
  ["/teachers-page", "/teachers"],
  ["/teach", "/teach-with-us"],
  // Moderator role removed per ADR-0003 (2026-05-08). Features absorbed into
  // /admin/*. CV review's path differs (was /moderator/cv-review/[teacherId];
  // admin equivalent at /admin/teachers/cv/[teacherId]) so it must come BEFORE
  // the broader /moderator → /admin entry — the loop matches in array order.
  ["/moderator/cv-review", "/admin/teachers/cv"],
  ["/moderator", "/admin"],
];

async function getUserRoleState(
  _supabase: Awaited<ReturnType<typeof updateSession>>["supabase"],
  userId: string,
): Promise<RoleState | null> {
  // Delegates to the tagged unstable_cache above. The supabase param is
  // kept in the signature for backward compatibility but unused; the cached
  // implementation creates its own admin client.
  return fetchRoleStateForUser(userId);
}

export async function proxy(request: NextRequest) {
  // Apply legacy rename redirects before auth — a 301 here is cheaper than
  // running the full auth/role pipeline only to redirect at the route layer.
  for (const [from, to] of RENAMED_ROUTES) {
    if (request.nextUrl.pathname === from || request.nextUrl.pathname.startsWith(`${from}/`)) {
      const url = request.nextUrl.clone();
      url.pathname = request.nextUrl.pathname.replace(from, to);
      return NextResponse.redirect(url, 301);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const { supabaseResponse, user, supabase } = await updateSession(request, nonce);
  supabaseResponse.headers.set(
    "Content-Security-Policy",
    buildContentSecurityPolicy(nonce),
  );
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
      const state = await withTimeout(
      getUserRoleState(supabase, user.id),
      ROLE_STATE_TIMEOUT_MS,
      null,
      "proxy.roleState",
    );
      if (state) {
        setSentryUser(user.id, state.active);
        const dashboard = `/${state.active}/dashboard`;
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

    // Fetch user role state (active role + full roles[] set).
    const state = await withTimeout(
      getUserRoleState(supabase, user.id),
      ROLE_STATE_TIMEOUT_MS,
      null,
      "proxy.roleState",
    );

    // Refresh Sentry scope with the active role for any errors below.
    setSentryUser(user.id, state?.active ?? null);

    if (state?.active !== requiredRole) {
      // Active role mismatch. If the user *holds* the required role in
      // their roles[] set, this is "you have it but aren't currently in
      // that mode" — bounce them to their active dashboard, where the
      // topbar dropdown lets them switch deliberately. If they don't hold
      // it at all, same redirect (their own dashboard or login).
      const home = state?.active ? `/${state.active}/dashboard` : "/login";
      return NextResponse.redirect(new URL(home, request.url));
    }

    break;
  }

  // Authenticated user on root "/" → redirect to their dashboard
  if (pathname === "/" && user) {
    const state = await withTimeout(
      getUserRoleState(supabase, user.id),
      ROLE_STATE_TIMEOUT_MS,
      null,
      "proxy.roleState",
    );
    if (state) {
      return NextResponse.redirect(
        new URL(`/${state.active}/dashboard`, request.url),
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
