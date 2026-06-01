import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { FollowUpUserError, type FollowUpActor } from "./types";

/**
 * Follow-up domain — shared internals.
 *
 * The admin Supabase client type the domain writes against (mirrors the
 * Progress domain's `recordProgress(admin, ...)` signature), plus the
 * row-level authorization helper every teacher/admin write shares.
 */
export type AdminClient = SupabaseClient<Database>;

/**
 * Row-level authorization: the actor must be the follow-up's owning
 * teacher, OR an admin. Mirrors the inline check the legacy actions did
 * after re-reading `profiles.role` — except the role is now resolved once
 * at the route adapter and passed in via `actor.isAdmin`.
 */
export function assertCanManage(
  actor: FollowUpActor,
  ownerTeacherId: string,
  message: string,
): void {
  if (ownerTeacherId === actor.id) return;
  if (actor.isAdmin) return;
  throw new FollowUpUserError(message);
}
