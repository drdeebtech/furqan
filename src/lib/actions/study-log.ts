"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

const VALID_KINDS = ["solo", "review", "dhikr", "manual"] as const;
type Kind = (typeof VALID_KINDS)[number];

function isKind(v: string): v is Kind {
  return (VALID_KINDS as readonly string[]).includes(v);
}

interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

// ─── startStudySession ──────────────────────────────────────────────────────
// Begins a stopwatch entry. The client polls/displays elapsed time locally;
// the server only stores the started_at marker. Caller must follow up with
// `endStudySession(id)` to close it. If the user never ends it, the row
// stays "open" (ended_at IS NULL) and the dashboard query treats it as 0
// minutes contributed (we only count rows with non-null duration_seconds).

export async function startStudySession(kind: string, notes?: string): Promise<ActionResult> {
  if (!isKind(kind)) return { ok: false, error: "نوع غير صالح" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("study_log")
    .insert({
      student_id: user.id,
      started_at: now,
      duration_seconds: 0,
      kind,
      notes: notes ?? null,
    } satisfies TableInsert<"study_log">)
    .select("id")
    .single<{ id: string }>();

  if (error) {
    logError("startStudySession failed", error, { tag: "study-log" });
    return { ok: false, error: error.message };
  }

  revalidatePath("/student/time-tracker");
  return { ok: true, id: data!.id };
}

// ─── endStudySession ────────────────────────────────────────────────────────
// Closes an open entry. Computes duration_seconds from the row's started_at,
// not from a client-provided number, so the server is the source of truth
// (prevents client-side spoofing of giant durations).

export async function endStudySession(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const { data: row } = await supabase
    .from("study_log")
    .select("started_at, ended_at, student_id")
    .eq("id", id)
    .single<{ started_at: string; ended_at: string | null; student_id: string }>();

  if (!row) return { ok: false, error: "السجل غير موجود" };
  if (row.student_id !== user.id) return { ok: false, error: "غير مصرح" };
  if (row.ended_at) return { ok: false, error: "الجلسة مغلقة بالفعل" };

  const endedAt = new Date();
  const durationSeconds = Math.max(
    0,
    Math.floor((endedAt.getTime() - new Date(row.started_at).getTime()) / 1000),
  );

  const { error } = await supabase
    .from("study_log")
    .update({
      ended_at: endedAt.toISOString(),
      duration_seconds: durationSeconds,
    } as TableUpdate<"study_log">)
    .eq("id", id);

  if (error) {
    logError("endStudySession failed", error, { tag: "study-log", id });
    return { ok: false, error: error.message };
  }

  revalidatePath("/student/time-tracker");
  revalidatePath("/student/dashboard");
  return { ok: true, id };
}

// ─── addManualEntry ─────────────────────────────────────────────────────────
// Retroactively log a study session. Used when the student forgot to start
// the stopwatch but wants the time on record.

export async function addManualEntry(
  durationMinutes: number,
  kind: string,
  notes?: string,
  whenIso?: string,
): Promise<ActionResult> {
  if (!isKind(kind)) return { ok: false, error: "نوع غير صالح" };
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 600) {
    return { ok: false, error: "المدة يجب أن تكون بين 1 و 600 دقيقة" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const ended = whenIso ? new Date(whenIso) : new Date();
  const seconds = Math.floor(durationMinutes * 60);
  const started = new Date(ended.getTime() - seconds * 1000);

  const { data, error } = await supabase
    .from("study_log")
    .insert({
      student_id: user.id,
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      duration_seconds: seconds,
      kind,
      notes: notes ?? null,
    } satisfies TableInsert<"study_log">)
    .select("id")
    .single<{ id: string }>();

  if (error) {
    logError("addManualEntry failed", error, { tag: "study-log" });
    return { ok: false, error: error.message };
  }

  revalidatePath("/student/time-tracker");
  revalidatePath("/student/dashboard");
  return { ok: true, id: data!.id };
}

// ─── deleteStudyEntry ───────────────────────────────────────────────────────

export async function deleteStudyEntry(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مسجل الدخول" };

  const { error } = await supabase
    .from("study_log")
    .delete()
    .eq("id", id)
    .eq("student_id", user.id); // RLS double-check

  if (error) {
    logError("deleteStudyEntry failed", error, { tag: "study-log", id });
    return { ok: false, error: error.message };
  }

  revalidatePath("/student/time-tracker");
  revalidatePath("/student/dashboard");
  return { ok: true };
}
