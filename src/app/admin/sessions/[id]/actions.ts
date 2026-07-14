"use server";

import { z } from "zod";
import {
  ForbiddenError,
  UnauthenticatedError,
  requireAdmin,
} from "@/lib/auth/require-admin";
import { sendSessionNarrative, type SendNarrativeResult } from "@/lib/reports/send-narrative";

/**
 * Admin-gated server action in front of the unguarded internal helper
 * (issue #689). The actor is the session user — never client input — so a
 * hostile caller can't spoof actorId or trigger parent reports for
 * arbitrary sessions.
 */
export async function sendSessionReport(sessionId: string): Promise<SendNarrativeResult> {
  let actorId: string;
  try {
    ({ id: actorId } = await requireAdmin());
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof UnauthenticatedError) {
      return { ok: false, error: "غير مصرح" };
    }
    throw e;
  }

  const parsed = z.string().uuid().safeParse(sessionId);
  if (!parsed.success) {
    return { ok: false, error: "معرّف جلسة غير صالح" };
  }

  return sendSessionNarrative({ sessionId: parsed.data, actorId });
}
