"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { invalidateRoleCache } from "@/lib/auth/role-cache";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";
import type { UserRole } from "@/types/database";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

const VALID_ROLES = ["student", "teacher", "admin"] as const;
const targetRoleSchema = z.object({
  targetRole: z.enum(VALID_ROLES),
});

/**
 * Switch the caller's *active* role to one of the roles they hold in their
 * `profiles.roles` set. Topbar dropdown calls this when the user picks
 * a different role to "wear."
 *
 * Two safety rails:
 *   1. The target role must already be a member of the user's `roles[]`
 *      set — you can't promote yourself by passing "admin" if you weren't
 *      granted it.
 *   2. The DB-level CHECK constraint `profiles_active_role_in_set` is the
 *      ultimate backstop: writing an active role outside the set fails the
 *      transaction.
 *
 * After a successful update we invalidate the per-user role cache used by
 * `src/proxy.ts` so the next request lands in the new dashboard immediately
 * (no 10-second TTL wait), then redirect the browser there.
 *
 * Wrapped in loudAction for audit_log integration. The redirect() throw
 * propagates through loudAction's isRedirectError branch — see loud.ts.
 */
const switchActiveRoleBase = loudAction<{ targetRole: UserRole }, { message: string }>({
  name: "auth.switch-active-role",
  severity: "warning",
  schema: targetRoleSchema,
  audit: {
    table: "profiles",
    recordId: () => "self",
    action: "UPDATE",
    reasonPrefix: "active-role-switch",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    return { actorId: user.id };
  },
  handler: async ({ targetRole }, { actorId }) => {
    const supabase = await createClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, roles")
      .eq("id", actorId!)
      .single<{ role: UserRole; roles: UserRole[] }>();

    if (!profile) redirect("/login");

    const currentRoles = profile.roles ?? [profile.role];
    if (!currentRoles.includes(targetRole)) {
      Sentry.addBreadcrumb?.({
        category: "auth.role-switch.denied",
        level: "warning",
        message: `${actorId} tried to switch to ${targetRole} without holding it`,
        data: { from: profile.role, requested: targetRole, holds: currentRoles },
      });
      redirect(`/${profile.role}/dashboard`);
    }

    // No-op if the user clicked their currently-active role.
    if (profile.role === targetRole) {
      redirect(`/${targetRole}/dashboard`);
    }

    Sentry.addBreadcrumb?.({
      category: "auth.role-switch",
      level: "info",
      message: `${actorId} switched active role: ${profile.role} → ${targetRole}`,
      data: { from: profile.role, to: targetRole },
    });

    const { error } = await supabase
      .from("profiles")
      .update({ role: targetRole } satisfies TableUpdate<"profiles">)
      .eq("id", actorId!);

    if (error) {
      // Failure-recovery redirect. Log here so observability survives
      // even though loudAction's isRedirectError branch will record the
      // audit row as success (the redirect IS reached). The logError
      // tag = "auth" + the Sentry event are the source of truth for
      // post-write failures, not the audit_log row.
      logError("switchActiveRole DB write failed", error, {
        tag: "auth",
        component: "active-role",
        metadata: { userId: actorId, from: profile.role, to: targetRole },
      });
      redirect(`/${profile.role}/dashboard`);
    }

    invalidateRoleCache(actorId!);
    redirect(`/${targetRole}/dashboard`);
  },
});

/**
 * Public wrapper preserving the call site's existing signature
 * `switchActiveRole(role)` so topbar.tsx (and any other caller) doesn't
 * need to change. Returns Promise<never> by convention — every path
 * inside the wrapped base either redirects (propagates) or throws.
 */
export async function switchActiveRole(targetRole: UserRole): Promise<never> {
  await switchActiveRoleBase({ targetRole });
  // Unreachable — the base either redirects (throws NEXT_REDIRECT, propagated
  // by loudAction's isRedirectError branch) or returns a LoudResult on
  // validation failure. We throw here to preserve the `never` signature
  // contract; in practice control returns to the topbar caller via the
  // redirect throw before reaching this line.
  throw new Error("switchActiveRole: handler completed without redirect (unreachable)");
}
