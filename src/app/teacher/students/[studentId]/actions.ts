"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { loudAction } from "@/lib/actions/loud";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";
import { UserError } from "@/lib/actions/user-error";
import { createParentToken, revokeParentToken } from "@/lib/domains/parent-portal/tokens";

async function loggedInPreflight(): Promise<{ actorId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مصرح");
  return { actorId: user.id };
}

/** Resolve the caller as a teacher/admin actor (parent-link actions, #563). */
async function teacherOrAboveActor(): Promise<{ id: string; isAdmin: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new UserError("غير مصرح");
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || !["admin", "teacher"].includes(profile.role)) throw new UserError("غير مصرح");
  return { id: user.id, isAdmin: profile.role === "admin" };
}

// ─── resolveRecitationError ─────────────────────────────────────────────────

const resolveRecitationErrorBase = loudAction<{ errorId: string }, { message: string }>({
  name: "teacher.students.resolve-recitation-error",
  severity: "info",
  audit: {
    table: "recitation_errors",
    recordId: (i) => i.errorId,
    action: "UPDATE",
    reasonPrefix: "teacher resolve recitation error",
  },
  preflight: loggedInPreflight,
  handler: async ({ errorId }) => {
    const supabase = await createClient();
    // `.select()` makes the update return the rows it touched. RLS-denied
    // updates (or updates on a non-existent id) come back with `error: null`
    // and `data: []` — without this, the wrap would silently log "success"
    // for a write that affected zero rows. Defense-in-depth flagged by
    // CodeRabbit on PR #271.
    const { data, error } = await supabase
      .from("recitation_errors")
      .update({ resolved: true, resolved_at: new Date().toISOString() } satisfies TableUpdate<"recitation_errors">)
      .eq("id", errorId)
      .select("id");
    if (error) throw new UserError("فشل تحديث الخطأ — يرجى المحاولة مرة أخرى", { cause: error });
    if (!data || data.length === 0) {
      throw new UserError("الخطأ غير موجود أو ليس لديك صلاحية عليه");
    }
    revalidatePath("/teacher/students");
    return { message: "resolved" };
  },
});

export async function resolveRecitationError(
  errorId: string,
): Promise<{ success?: true; error?: string }> {
  const result = await resolveRecitationErrorBase({ errorId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── updateSessionNotes ─────────────────────────────────────────────────────

type UpdateSessionNotesInput = { sessionId: string; notes: string };

const updateSessionNotesBase = loudAction<UpdateSessionNotesInput, { message: string }>({
  name: "teacher.students.update-session-notes",
  severity: "info",
  audit: {
    table: "sessions",
    recordId: (i) => i.sessionId,
    action: "UPDATE",
    reasonPrefix: "teacher update session notes",
  },
  preflight: loggedInPreflight,
  handler: async ({ sessionId, notes }) => {
    const supabase = await createClient();
    // See note in resolveRecitationError above — `.select()` catches the
    // RLS-denial silent-no-op pattern. (CodeRabbit PR #271.)
    const { data, error } = await supabase
      .from("sessions")
      .update({ post_session_notes: notes || null } satisfies TableUpdate<"sessions">)
      .eq("id", sessionId)
      .select("id");
    if (error) throw new UserError("فشل تحديث الملاحظات — يرجى المحاولة مرة أخرى", { cause: error });
    if (!data || data.length === 0) {
      throw new UserError("الجلسة غير موجودة أو ليس لديك صلاحية عليها");
    }
    revalidatePath("/teacher/students");
    return { message: "saved" };
  },
});

export async function updateSessionNotes(
  sessionId: string,
  notes: string,
): Promise<{ success?: true; error?: string }> {
  const result = await updateSessionNotesBase({ sessionId, notes });
  if (!result.ok) return { error: result.error };
  return { success: true };
}

// ─── generateParentLink (#563) ──────────────────────────────────────────────

const generateParentLinkBase = loudAction<{ studentId: string }, { message: string }>({
  name: "teacher.students.generate-parent-link",
  severity: "info",
  schema: z.object({ studentId: z.string().uuid() }) as unknown as z.ZodType<{ studentId: string }>,
  audit: {
    table: "parent_access_tokens",
    recordId: (i) => i.studentId,
    action: "INSERT",
    reasonPrefix: "generate parent portal link",
  },
  preflight: loggedInPreflight,
  handler: async ({ studentId }) => {
    const actor = await teacherOrAboveActor();
    // createParentToken verifies the teacher actually teaches this student
    // (a booking links them) unless admin — authorization never trusts studentId.
    let minted: { token: string; id: string; expiresAt: string };
    try {
      minted = await createParentToken({ studentId, teacherId: actor.id, isAdmin: actor.isAdmin });
    } catch (e) {
      const err = e as Error;
      // not_authorized is an expected user error — no `cause`, so loudAction
      // doesn't escalate it to Sentry/Telegram as a system failure.
      if (err.message === "not_authorized") throw new UserError("ليس لديك صلاحية على هذا الطالب");
      throw new UserError("فشل إنشاء الرابط", { cause: err });
    }
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://furqan.today").replace(/\/$/, "");
    // The link + its id/expiry travel back via the loud-result `message` field.
    return { message: JSON.stringify({ url: `${base}/parent/${minted.token}`, id: minted.id, expiresAt: minted.expiresAt }) };
  },
});

export async function generateParentLink(
  studentId: string,
): Promise<{ url?: string; id?: string; expiresAt?: string; error?: string }> {
  const result = await generateParentLinkBase({ studentId });
  if (!result.ok) return { error: result.error };
  try {
    const parsed = JSON.parse(result.message ?? "{}") as { url: string; id: string; expiresAt: string };
    return { url: parsed.url, id: parsed.id, expiresAt: parsed.expiresAt };
  } catch {
    return { error: "فشل إنشاء الرابط" };
  }
}

// ─── revokeParentLink (#563) ────────────────────────────────────────────────

const revokeParentLinkBase = loudAction<{ tokenId: string }, { message: string }>({
  name: "teacher.students.revoke-parent-link",
  severity: "info",
  schema: z.object({ tokenId: z.string().uuid() }) as unknown as z.ZodType<{ tokenId: string }>,
  audit: {
    table: "parent_access_tokens",
    recordId: (i) => i.tokenId,
    action: "UPDATE",
    reasonPrefix: "revoke parent portal link",
  },
  preflight: loggedInPreflight,
  handler: async ({ tokenId }) => {
    const actor = await teacherOrAboveActor();
    await revokeParentToken({ tokenId, teacherId: actor.id, isAdmin: actor.isAdmin });
    revalidatePath("/teacher/students");
    return { message: "revoked" };
  },
});

export async function revokeParentLink(tokenId: string): Promise<{ success?: true; error?: string }> {
  const result = await revokeParentLinkBase({ tokenId });
  if (!result.ok) return { error: result.error };
  return { success: true };
}
