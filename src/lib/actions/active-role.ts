"use server";

import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { invalidateRoleCache } from "@/lib/auth/role-cache";
import { logError } from "@/lib/logger";
import type { UserRole } from "@/types/database";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

const VALID: ReadonlySet<UserRole> = new Set(["student", "teacher", "admin"]);

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
 */
export async function switchActiveRole(targetRole: UserRole): Promise<never> {
  if (!VALID.has(targetRole)) {
    throw new Error(`switchActiveRole: invalid target "${targetRole}"`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, roles")
    .eq("id", user.id)
    .single<{ role: UserRole; roles: UserRole[] }>();

  if (!profile) redirect("/login");

  const currentRoles = profile.roles ?? [profile.role];
  if (!currentRoles.includes(targetRole)) {
    Sentry.addBreadcrumb?.({
      category: "auth.role-switch.denied",
      level: "warning",
      message: `${user.id} tried to switch to ${targetRole} without holding it`,
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
    message: `${user.id} switched active role: ${profile.role} → ${targetRole}`,
    data: { from: profile.role, to: targetRole },
  });

  const { error } = await supabase
    .from("profiles")
    .update({ role: targetRole } satisfies TableUpdate<"profiles">)
    .eq("id", user.id);

  if (error) {
    logError("switchActiveRole DB write failed", error, {
      tag: "auth",
      component: "active-role",
      metadata: { userId: user.id, from: profile.role, to: targetRole },
    });
    redirect(`/${profile.role}/dashboard`);
  }

  invalidateRoleCache(user.id);
  redirect(`/${targetRole}/dashboard`);
}
