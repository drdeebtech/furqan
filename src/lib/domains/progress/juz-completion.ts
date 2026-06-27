import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";
import { emitEvent } from "@/lib/automation/emit";
import { awardAchievement } from "@/lib/domains/achievements/award";
import { issueCertificate } from "@/lib/domains/certificates/issue";
import { logError } from "@/lib/logger";
import { notify } from "@/lib/notifications/dispatcher";
import { completedJuz, type MemorizedRange } from "./juz-coverage";

type AdminClient = SupabaseClient<Database>;
type ProgressOwner = { student_id: string; teacher_id: string };
type ProgressRangeRow = {
  surah_from: number | null;
  ayah_from: number | null;
  surah_to: number | null;
  ayah_to: number | null;
};

export async function detectJuzCompletions(
  admin: AdminClient,
  progressId: string,
): Promise<void> {
  try {
    const owner = await loadProgressOwner(admin, progressId);
    const ranges = await loadMemorizedRanges(admin, owner.student_id);

    for (const juz of completedJuz(ranges)) {
      await issueJuzMilestone(owner, progressId, juz);
    }
  } catch (error) {
    logError("detectJuzCompletions failed", error, { tag: "progress", progressId });
  }
}

async function loadProgressOwner(admin: AdminClient, progressId: string): Promise<ProgressOwner> {
  const { data: owner, error } = await admin
    .from("student_progress")
    .select("student_id, teacher_id")
    .eq("id", progressId)
    .maybeSingle<ProgressOwner>();

  if (error) throw error;
  if (!owner) throw new Error(`student_progress row not found: ${progressId}`);
  return owner;
}

async function loadMemorizedRanges(
  admin: AdminClient,
  studentId: string,
): Promise<MemorizedRange[]> {
  const { data: rows, error } = await admin
    .from("student_progress")
    .select("surah_from, ayah_from, surah_to, ayah_to")
    .eq("student_id", studentId)
    .returns<ProgressRangeRow[]>();

  if (error) throw error;
  return (rows ?? []).filter(hasCompleteRange).map((row) => ({
    surahFrom: row.surah_from,
    ayahFrom: row.ayah_from,
    surahTo: row.surah_to,
    ayahTo: row.ayah_to,
  }));
}

function hasCompleteRange(row: ProgressRangeRow): row is ProgressRangeRow & {
  surah_from: number;
  ayah_from: number;
  surah_to: number;
  ayah_to: number;
} {
  return (
    row.surah_from !== null &&
    row.ayah_from !== null &&
    row.surah_to !== null &&
    row.ayah_to !== null
  );
}

async function issueJuzMilestone(
  owner: ProgressOwner,
  progressId: string,
  juz: number,
): Promise<void> {
  try {
    const issuance = await issueCertificate(owner.student_id, "appreciation_juz", String(juz));
    if (!issuance.ok) {
      logError("juz certificate issuance failed", new Error(issuance.error), {
        tag: "progress",
        studentId: owner.student_id,
        juz,
      });
      return;
    }
    if (issuance.idempotent) return;
    await announceJuzCompletion(owner, progressId, juz);
    // Award first_juz badge (spec 033). Idempotent — repeat calls on subsequent
    // juz are silent no-ops thanks to the DB unique constraint.
    await awardAchievement(owner.student_id, "first_juz", { juz }).catch((err) =>
      logError("first_juz award failed", err, { tag: "achievements", juz }),
    );
  } catch (error) {
    logError("juz milestone processing failed", error, {
      tag: "progress",
      studentId: owner.student_id,
      juz,
    });
  }
}

async function announceJuzCompletion(
  owner: ProgressOwner,
  progressId: string,
  juz: number,
): Promise<void> {
  const eventData = {
    student_id: owner.student_id,
    teacher_id: owner.teacher_id,
    juz,
  };
  await Promise.all([
    emitEvent("progress.juz_completed", "student_progress", owner.student_id, eventData).catch(
      (error) => logError("emit progress.juz_completed failed", error, { tag: "automation", juz }),
    ),
    notifyStudent(owner.student_id, progressId, juz),
    notifyTeacher(owner, progressId, juz),
  ]);
}

async function notifyStudent(studentId: string, progressId: string, juz: number): Promise<void> {
  await notify({
    userId: studentId,
    type: "system",
    title: `مبارك! أتممت الجزء ${juz}`,
    body: "تم إصدار شهادة إتمام الجزء لك.",
    data: { juz },
    entityType: "student_progress",
    entityId: progressId,
  }).catch((error) => logError("student juz notification failed", error, { tag: "progress", juz }));
}

async function notifyTeacher(owner: ProgressOwner, progressId: string, juz: number): Promise<void> {
  await notify({
    userId: owner.teacher_id,
    type: "system",
    title: `أتمّ الطالب الجزء ${juz}`,
    body: "تم إصدار شهادة إتمام الجزء للطالب.",
    data: { student_id: owner.student_id, juz },
    entityType: "student_progress",
    entityId: progressId,
  }).catch((error) => logError("teacher juz notification failed", error, { tag: "progress", juz }));
}
