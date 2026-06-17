import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { emitEvent } from "@/lib/automation/emit";
import { logError } from "@/lib/logger";

/**
 * Spec 020 — Scheduling (US2 / T015).
 *
 * Domain layer for group halaqas and cohorts.
 */

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
      const conditions = offering.entry_conditions_json as any;
      if (conditions.required_confirmation && !entryConfirmation) {
        throw new EntryConditionError("Entry conditions not met", conditions.prompt || "Confirmation required");
      }
    }

    // 4. Join the target halaqa (session_participants)
    // We use offering.session_id if the session is already created.
    // If it's a new overflow, the session might not exist yet depending on creation logic.
    // For now, we assume offering.session_id is populated.
    let sessionId = offering.session_id;

    if (!sessionId && overflowRedirected) {
      // If redirected to overflow, we need the overflow's session_id
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
      } as any)
      .select("id")
      .single();

    if (joinErr) {
      if (joinErr.code === "23505") {
        return { ok: false, error: "You are already a member of this halaqa" };
      }
      throw joinErr;
    }

    // 5. Increment enrollment (atomic)
    const { error: incErr } = await admin.rpc("increment_enrollment", {
      p_offering_id: targetId
    });

    if (incErr) {
      logError("joinHalaqa: enrollment increment failed", incErr, { target_id: targetId });
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
  let members: any[] = [];
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
      members = participants.map((p) => {
        const profile = Array.isArray(p.profile) ? p.profile[0] : p.profile;
        return {
          id: p.user_id,
          name: profile?.full_name,
          name_ar: profile?.full_name_ar,
        };
      });
    }
  }

  // 3. Fetch sibling halaqas
  let sibling_halaqas: any[] = [];
  if (offering.program_level) {
    const { data: siblings } = await admin
      .from("class_offerings")
      .select("id, capacity, current_enrollment, status")
      .eq("teacher_id", offering.teacher_id)
      .eq("program_level", offering.program_level)
      .neq("id", classOfferingId);
      
    if (siblings) {
      sibling_halaqas = siblings;
    }
  }

  return {
    capacity: offering.capacity,
    current_enrollment: offering.current_enrollment,
    members,
    sibling_halaqas,
  };
}
