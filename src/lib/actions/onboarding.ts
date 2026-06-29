"use server";

/**
 * Issue #545 — flips `profiles.onboarding_completed` to true.
 *
 * SECURITY: `actorId` (the profile row PK to update) is derived EXCLUSIVELY
 * from the authenticated Supabase session via `supabase.auth.getUser()` —
 * first in `preflight`, then re-derived and equality-checked in `handler`.
 * It is NEVER read from request input, formData, or props. RLS
 * (`profiles_update`: `auth.uid() = id`) additionally enforces that the
 * session user can only touch their own row, so even a logic bug here
 * cannot mutate another user's flag.
 *
 * The action takes no input (and therefore no zod schema) — there is
 * nothing to validate because there is nothing the caller controls.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

const completeOnboardingBase = loudAction<undefined, { message?: string }>({
  name: "student.complete-onboarding",
  severity: "info",
  audit: {
    table: "profiles",
    // actorId IS the profile PK (auth.users.id == profiles.id).
    recordId: (_i, actorId) => actorId,
    action: "UPDATE",
    reasonPrefix: "student onboarding completed (issue #545)",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("غير مصرح");
    return { actorId: user.id };
  },
  handler: async (_input, { actorId }) => {
    // Re-derive the session user inside the handler and assert it matches
    // the preflight actor — defense in depth against any cross-request
    // state reuse.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== actorId) throw new Error("غير مصرح");

    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true } as TableUpdate<"profiles">)
      .eq("id", user.id);
    if (error) throw error;

    emitEvent(
      "profile.updated",
      "profile",
      user.id,
      { updated_fields: ["onboarding_completed"], onboarding_completed: true },
      user.id,
    ).catch((err) =>
      logError("emit profile.updated (onboarding) failed", err, {
        tag: "onboarding",
        actorId: user.id,
      }),
    );

    revalidatePath("/student/dashboard");
    revalidatePath("/student/teachers");
    return { message: "تم تأهيل حسابك" };
  },
});

/**
 * Mark the authenticated student's onboarding as complete. No arguments —
 * the row to update is resolved entirely from the session.
 */
export async function completeOnboarding(): Promise<LoudResult> {
  return completeOnboardingBase(undefined);
}
