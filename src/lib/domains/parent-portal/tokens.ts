import "server-only";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { ayahCount } from "@/lib/quran/ayah-counts";

/**
 * Magic-link parent portal (#563) — token lifecycle + scoped read.
 *
 * The token is a 256-bit URL-safe random secret. A parent visits
 * /parent/[token] with no account; the portal resolves the token via the
 * service-role key (RLS-bypassing) with a fail-closed filter, then reads only
 * that one student's data. `userId`/`studentId` are NEVER taken from the URL —
 * they come from the token row. NOTE: `parent_access_tokens` is a brand-new
 * table; its generated types land in a follow-up regen PR (repo convention),
 * so accesses cast the table name until then.
 */

const TOKEN_TTL_DAYS = 30;
const TABLE = "parent_access_tokens" as never;

export interface ParentTokenRow {
  id: string;
  token: string;
  student_id: string;
  teacher_id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Mint a scoped token for one student. The teacher must actually teach the
 * student (a booking links them) unless the caller is an admin — authorization
 * never trusts the studentId alone. Returns the raw token (shown once).
 */
export async function createParentToken(input: {
  studentId: string;
  teacherId: string;
  isAdmin: boolean;
}): Promise<{ token: string; expiresAt: string }> {
  const admin = createAdminClient();

  if (!input.isAdmin) {
    const { data: link } = await admin
      .from("bookings")
      .select("id")
      .eq("teacher_id", input.teacherId)
      .eq("student_id", input.studentId)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!link) throw new Error("not_authorized");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000).toISOString();

  const { error } = await admin.from(TABLE).insert({
    token,
    student_id: input.studentId,
    teacher_id: input.teacherId,
    expires_at: expiresAt,
  } as never);
  if (error) throw new Error(error.message);

  return { token, expiresAt };
}

/** Revoke a token. Scoped to the owning teacher unless admin. */
export async function revokeParentToken(input: {
  tokenId: string;
  teacherId: string;
  isAdmin: boolean;
}): Promise<void> {
  const admin = createAdminClient();
  let q = admin
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString() } as never)
    .eq("id", input.tokenId);
  if (!input.isAdmin) q = q.eq("teacher_id", input.teacherId);
  const { error } = await q.select("id");
  if (error) throw new Error(error.message);
}

/** Active (non-revoked, non-expired) tokens for a student, for the teacher UI. */
export async function listActiveParentTokens(input: {
  studentId: string;
  teacherId: string;
}): Promise<{ id: string; createdAt: string; expiresAt: string }[]> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data } = await admin
    .from(TABLE)
    .select("id, created_at, expires_at")
    .eq("student_id", input.studentId)
    .eq("teacher_id", input.teacherId)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .returns<{ id: string; created_at: string; expires_at: string }[]>();
  return (data ?? []).map((r) => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at }));
}

/**
 * Resolve a token to its student. Fail-closed: returns null for unknown,
 * revoked, or expired tokens. Service-role read (RLS-bypassing) by design —
 * the parent is unauthenticated.
 */
export async function resolveParentToken(token: string): Promise<{ studentId: string } | null> {
  if (!token || token.length < 16) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from(TABLE)
    .select("student_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle<{ student_id: string; expires_at: string; revoked_at: string | null }>();
  if (!data) return null;
  if (data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return { studentId: data.student_id };
}

export interface ParentPortalView {
  studentFirstName: string;
  progress: { range: string; quality: number | null; teacherNotes: string | null; date: string }[];
  upcomingSessions: { scheduledAt: string; sessionType: string; durationMin: number }[];
  recentErrors: { errorType: string; surah: number | null; ayah: number; note: string | null }[];
}

function formatRange(sf: number | null, af: number | null, st: number | null, at: number | null): string {
  if (!sf) return "—";
  const from = af ? `${sf}:${af}` : `${sf}`;
  const to = st && at ? `${st}:${at}` : null;
  return to && to !== from ? `${from} – ${to}` : from;
}

/**
 * The portal's read bundle, scoped to one student. First name only — no other
 * PII (AC: "no PII beyond student first name"). Service-role reads with an
 * explicit `student_id = ?` guard; the studentId comes from the resolved token.
 */
export async function getParentPortalView(studentId: string): Promise<ParentPortalView> {
  const admin = createAdminClient();
  const sinceIso = new Date(Date.now() - 30 * 86400_000).toISOString();
  const nowIso = new Date().toISOString();

  const [profileRes, progressRes, sessionsRes, progressIdsRes] = await Promise.all([
    admin.from("profiles").select("full_name").eq("id", studentId).maybeSingle<{ full_name: string | null }>(),
    admin
      .from("student_progress")
      .select("surah_from, ayah_from, surah_to, ayah_to, quality_rating, teacher_notes, created_at")
      .eq("student_id", studentId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<{ surah_from: number | null; ayah_from: number | null; surah_to: number | null; ayah_to: number | null; quality_rating: number | null; teacher_notes: string | null; created_at: string }[]>(),
    admin
      .from("bookings")
      .select("scheduled_at, session_type, duration_min")
      .eq("student_id", studentId)
      .eq("status", "confirmed")
      .gt("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(10)
      .returns<{ scheduled_at: string; session_type: string; duration_min: number }[]>(),
    admin
      .from("student_progress")
      .select("id")
      .eq("student_id", studentId)
      .gte("created_at", sinceIso)
      .returns<{ id: string }[]>(),
  ]);

  const fullName = profileRes.data?.full_name?.trim() ?? "";
  const studentFirstName = fullName ? fullName.split(/\s+/)[0] : "الطالب";

  let recentErrors: ParentPortalView["recentErrors"] = [];
  const progressIds = (progressIdsRes.data ?? []).map((p) => p.id);
  if (progressIds.length > 0) {
    const { data: errs } = await admin
      .from("recitation_errors")
      .select("error_type, surah_num, ayah_num, note")
      .in("progress_id", progressIds)
      .neq("note", "__no_errors_observed_sentinel__")
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<{ error_type: string; surah_num: number | null; ayah_num: number; note: string | null }[]>();
    recentErrors = (errs ?? [])
      // Defensive: never surface a row whose ayah is out of range for its surah.
      .filter((e) => e.surah_num == null || (ayahCount(e.surah_num) ?? 0) >= e.ayah_num)
      .map((e) => ({ errorType: e.error_type, surah: e.surah_num, ayah: e.ayah_num, note: e.note }));
  }

  return {
    studentFirstName,
    progress: (progressRes.data ?? []).map((p) => ({
      range: formatRange(p.surah_from, p.ayah_from, p.surah_to, p.ayah_to),
      quality: p.quality_rating,
      teacherNotes: p.teacher_notes,
      date: p.created_at,
    })),
    upcomingSessions: (sessionsRes.data ?? []).map((s) => ({
      scheduledAt: s.scheduled_at,
      sessionType: s.session_type,
      durationMin: s.duration_min,
    })),
    recentErrors,
  };
}
