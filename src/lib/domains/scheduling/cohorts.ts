import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import type { TableInsert } from "@/lib/supabase/typed-helpers";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

/**
 * Spec 020 — Scheduling (US2 / T015).
 *
 * Domain layer for group halaqas and cohorts.
 */

/** Shape of `class_offerings.entry_conditions_json` (US3 course gating). */
interface EntryConditions {
  required_confirmation?: boolean;
  prompt?: string;
}

/** Roster member row (US5 admin view). */
export interface RosterMember {
  id: string;
  name: string | null;
  name_ar: string | null;
}

/** Sibling halaqa row (US5 admin view). */
export interface SiblingHalaqa {
  id: string;
  capacity: number;
  current_enrollment: number;
  status: string;
}

export interface JoinResult {
  ok: true;
  membershipId: string;
  classOfferingId: string;
  overflowRedirected: boolean;
}

export interface JoinFailure {
  ok: false;
  error: string;
  unmetCondition?: string;
}

export class EntryConditionError extends Error {
  unmetCondition: string;
  constructor(message: string, unmetCondition: string) {
    super(message);
    this.name = "EntryConditionError";
    this.unmetCondition = unmetCondition;
  }
}

/**
 * Join a halaqa (group class offering). 
 * If the offering is at capacity, automatically redirects to a sibling or new overflow halaqa.
 * 
 * 1. Fetch class_offering details.
 * 2. If full, call open_overflow_halaqa (atomic sibling reuse or clone).
 * 3. Validate entry conditions if product_type = 'course' (T018).
 * 4. Insert into session_participants.
 * 5. Increment current_enrollment.
 */
export async function joinHalaqa(
  supabase: SupabaseClient<Database>,
  admin: SupabaseClient<Database>,
  userId: string,
  classOfferingId: string,
  entryConfirmation?: string,
): Promise<JoinResult | JoinFailure> {
  try {
    // 1. Fetch offering details
    const { data: offering, error: offErr } = await admin
      .from("class_offerings")
      .select("id, capacity, current_enrollment, status, session_type, entry_conditions_json, session_id")
      .eq("id", classOfferingId)
      .single();

    if (offErr || !offering) {
      return { ok: false, error: "Halaqa not found" };
    }

    let targetId = classOfferingId;
    let overflowRedirected = false;

    // 2. Overflow logic: if full, find/open a sibling
    if (offering.current_enrollment >= offering.capacity) {
      const { data: overflow, error: overErr } = await admin.rpc("open_overflow_halaqa", {
        p_source_offering_id: classOfferingId
      });

      if (overErr || !overflow || overflow.length === 0) {
        return { ok: false, error: "Failed to open overflow halaqa" };
      }

      targetId = overflow[0].halaqa_id;
      overflowRedirected = true;
      
      // Emit cohort_opened event if a new one was created (FR-021)
      if (overflow[0].was_created) {
        emitEvent("cohort.opened", "class_offering", targetId, {
          source_offering_id: classOfferingId,
        }, userId).catch((err) => logError("emit cohort.opened failed", err, { tag: "automation" }));
      }
    }

    // 3. Entry conditions (T018 / US3)
    if (offering.entry_conditions_json) {
      const conditions = offering.entry_conditions_json as EntryConditions;
      if (conditions.required_confirmation && !entryConfirmation) {
        throw new EntryConditionError("Entry conditions not met", conditions.prompt || "Confirmation required");
      }
    }

    // 4. Join the target halaqa (session_participants)
    // When overflow redirected, always resolve the session_id from the
    // overflow target offering — the source offering's session_id may be
    // stale or null after the overflow clone (CodeRabbit CR2).
    let sessionId: string | null = offering.session_id;

    if (overflowRedirected) {
      const { data: overflowOffering } = await admin
        .from("class_offerings")
        .select("session_id")
        .eq("id", targetId)
        .single();
      sessionId = overflowOffering?.session_id || null;
    }

    if (!sessionId) {
      return { ok: false, error: "Halaqa session not found" };
    }

    const { data: membership, error: joinErr } = await admin
      .from("session_participants")
      .insert({
        session_id: sessionId,
        user_id: userId,
        role: "student",
        attendance_status: "registered",
      } satisfies TableInsert<"session_participants">)
      .select("id")
      .single();

    if (joinErr) {
      if (joinErr.code === "23505") {
        return { ok: false, error: "You are already a member of this halaqa" };
      }
      throw joinErr;
    }

    // 5. Increment enrollment (atomic). Roll back participant row on failure to
    // prevent over-enrollment from a stale count.
    const { error: incErr } = await admin.rpc("increment_enrollment", {
      p_offering_id: targetId
    });

    if (incErr) {
      logError("joinHalaqa: enrollment increment failed — rolling back participant", incErr, { target_id: targetId });
      try {
        await admin.from("session_participants").delete().eq("id", membership.id);
      } catch (delErr) {
        logError("joinHalaqa: participant cleanup failed", delErr, {});
      }
      return { ok: false, error: "Failed to complete enrollment. Please try again." };
    }

    // Emit member.joined event (FR-021)
    emitEvent("member.joined", "class_offering", targetId, {
      student_id: userId,
      membership_id: membership.id,
    }, userId).catch((err) => logError("emit member.joined failed", err, { tag: "automation" }));

    return {
      ok: true,
      membershipId: membership.id,
      classOfferingId: targetId,
      overflowRedirected,
    };
  } catch (err) {
    if (err instanceof EntryConditionError) {
      throw err;
    }
    logError("joinHalaqa crashed", err, { user_id: userId, source_id: classOfferingId });
    return { ok: false, error: "Internal server error" };
  }
}

/**
 * Get halaqa roster and capacity information (US5 / T024).
 * Admin only.
 */
export async function getHalaqaRoster(
  admin: SupabaseClient<Database>,
  classOfferingId: string,
) {
  // 1. Fetch offering details
  const { data: offering, error: offErr } = await admin
    .from("class_offerings")
    .select("id, capacity, current_enrollment, program_level, teacher_id, session_id")
    .eq("id", classOfferingId)
    .single();

  if (offErr || !offering) {
    throw new Error("Halaqa not found");
  }

  // 2. Fetch participants
  const members: RosterMember[] = [];
  if (offering.session_id) {
    const { data: participants, error: partErr } = await admin
      .from("session_participants")
      .select(`
        id,
        user_id,
        attendance_status,
        profile:profiles!user_id (
          full_name,
          full_name_ar
        )
      `)
      .eq("session_id", offering.session_id)
      .eq("attendance_status", "registered");

    if (!partErr && participants) {
      for (const p of participants) {
        const profile = Array.isArray(p.profile) ? p.profile[0] : p.profile;
        members.push({
          id: p.user_id,
          name: profile?.full_name ?? null,
          name_ar: profile?.full_name_ar ?? null,
        });
      }
    }
  }

  // 3. Fetch sibling halaqas
  const sibling_halaqas: SiblingHalaqa[] = [];
  if (offering.program_level) {
    const { data: siblings } = await admin
      .from("class_offerings")
      .select("id, capacity, current_enrollment, status")
      .eq("teacher_id", offering.teacher_id)
      .eq("program_level", offering.program_level)
      .neq("id", classOfferingId);

    if (siblings) {
      for (const s of siblings) {
        sibling_halaqas.push({
          id: s.id,
          capacity: s.capacity,
          current_enrollment: s.current_enrollment,
          status: s.status,
        });
      }
    }
  }

  return {
    capacity: offering.capacity,
    current_enrollment: offering.current_enrollment,
    members,
    sibling_halaqas,
  };
}
