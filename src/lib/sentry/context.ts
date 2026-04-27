// Helpers for attaching user + tag context to Sentry events.
// Call these from request-scoped code (middleware/proxy, server actions,
// route handlers) so the next captured exception inside that scope carries
// the user id + role + any custom tags.

import * as Sentry from "@sentry/nextjs";
import type { UserRole } from "@/types/database";

export function setSentryUser(userId: string | null, role?: UserRole | null) {
  if (!userId) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: userId,
    // role is a custom segment in Sentry — usable as a filter / dashboard facet.
    segment: role ?? undefined,
  });
}

// Convenience for server actions where you already have a Supabase user object.
export function setSentryUserFromSupabase(
  user: { id: string; email?: string | null } | null,
  role?: UserRole | null,
) {
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id,
    email: user.email ?? undefined,
    segment: role ?? undefined,
  });
}
