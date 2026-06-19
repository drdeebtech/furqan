import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

/**
 * Spec 023 (م٦) — teacher notes per student (guardian-readable).
 *
 * Teacher-authored notes are visible to: the authoring teacher, the student
 * themselves, and the student's linked guardian (via `guardian_children`).
 * RLS enforces this; these helpers run via the service-role admin client
 * (server-only) and rely on RLS for any client-facing reads via the user's
 * own session client.
 *
 * CR/LF stripping (FR-016): any value that may later land in a notification
 * subject/header is sanitized here at the write boundary so downstream
 * notification routing doesn't have to re-check.
 */

const MAX_CONTENT_LENGTH = 5000;
const CR_REGEX = /\r/g;
const CRLF_REGEX = /[\r\n]/g;

/** Strip CR and LF (both are header-injection vectors when embedded in subject/header). */
export function sanitizeForHeader(value: string): string {
  return (value ?? "").replace(CRLF_REGEX, "").trim();
}

/** Normalize note content: trim, strip CR (LF preserved for readability), cap length. */
export function normalizeNoteContent(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) throw new Error("note content cannot be empty");
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    throw new Error(`note content exceeds ${MAX_CONTENT_LENGTH} chars`);
  }
  return trimmed.replace(CR_REGEX, "");
}

export interface TeacherNoteRow {
  id: string;
  student_id: string;
  teacher_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/**
 * Read notes for a student. RLS scopes the result to the caller's permissions
 * when called via the user's session client; via the admin client it returns
 * all notes for that student (service-role use only — e.g. report generation).
 */
export async function getNotesForStudent(
  studentId: string,
  opts: { admin?: boolean } = {},
): Promise<TeacherNoteRow[]> {
  const supabase = opts.admin ? createAdminClient() : await userClient();
  const { data, error } = await supabase
    .from("teacher_notes")
    .select("id, student_id, teacher_id, content, created_at, updated_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .returns<TeacherNoteRow[]>();
  if (error) {
    logError("getNotesForStudent: query failed", error, {
      tag: "reports",
      student_id: studentId,
    });
    return [];
  }
  return data ?? [];
}

/**
 * Create a note. Validates teacher assignment before writing (defense-in-depth
 * on top of RLS — a misconfigured assignment table must not silently widen
 * note-write access).
 */
export async function createNote(
  studentId: string,
  teacherId: string,
  rawContent: string,
): Promise<{ ok: true; note: TeacherNoteRow } | { ok: false; error: string; status?: number }> {
  let content: string;
  try {
    content = normalizeNoteContent(rawContent);
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 422 };
  }

  const admin = createAdminClient();

  // Teacher-assignment check: read from spec 020's authoritative assignment
  // table. The real schema uses `subscription_teacher_assignments`, not a
  // generic `assignments` table.
  const { data: assignment, error: assignmentErr } = await admin
    .from("subscription_teacher_assignments")
    .select("teacher_id")
    .eq("student_id", studentId)
    .eq("teacher_id", teacherId)
    .eq("is_active", true)
    .maybeSingle<{ teacher_id: string }>();
  if (assignmentErr) {
    logError("createNote: assignment lookup failed", assignmentErr, {
      tag: "reports", student_id: studentId, teacher_id: teacherId,
    });
    return { ok: false, error: "could not verify teacher assignment", status: 500 };
  }
  if (!assignment) {
    return { ok: false, error: "teacher is not assigned to this student", status: 403 };
  }

  const { data, error } = await admin
    .from("teacher_notes")
    .insert({ student_id: studentId, teacher_id: teacherId, content })
    .select("id, student_id, teacher_id, content, created_at, updated_at")
    .single<TeacherNoteRow>();
  if (error || !data) {
    logError("createNote: insert failed", error ?? new Error("no row"), {
      tag: "reports", student_id: studentId, teacher_id: teacherId,
    });
    return { ok: false, error: error?.message ?? "insert failed", status: 500 };
  }
  return { ok: true, note: data };
}

async function userClient() {
  const { createClient } = await import("@/lib/supabase/server");
  return createClient();
}
