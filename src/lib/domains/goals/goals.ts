import "server-only";
import type { ServerClient } from "@/lib/supabase/types";
import { ayahCount } from "@/lib/quran/ayah-counts";
import {
  countCoveredAyahs,
  projectCompletion,
  totalAyahsInRange,
  type QuranRange,
} from "./projection";

const PACE_WEEKS = 4;

export interface StudentGoalRow {
  id: string;
  student_id: string;
  surah_start: number;
  ayah_start: number;
  surah_end: number;
  ayah_end: number;
  target_date: string;
  created_at: string;
  updated_at: string;
}

interface ProgressRangeRow {
  surah_from: number;
  ayah_from: number;
  surah_to: number;
  ayah_to: number;
}

interface GoalProgressSnapshot {
  goalRanges: ProgressRangeRow[];
  recentRanges: ProgressRangeRow[];
}

export interface GoalDashboardData extends StudentGoalRow {
  memorizedAyahs: number;
  totalAyahs: number;
  ayahsPerWeek: number;
  projectedDate: string | null;
}

function toRange(row: StudentGoalRow): QuranRange;
function toRange(row: ProgressRangeRow): QuranRange;
function toRange(row: StudentGoalRow | ProgressRangeRow): QuranRange {
  if ("surah_start" in row) {
    return {
      surahStart: row.surah_start,
      ayahStart: row.ayah_start,
      surahEnd: row.surah_end,
      ayahEnd: row.ayah_end,
    };
  }
  return {
    surahStart: row.surah_from,
    ayahStart: row.ayah_from,
    surahEnd: row.surah_to,
    ayahEnd: row.ayah_to,
  };
}

export async function getActiveGoal(
  client: ServerClient,
  studentId: string,
): Promise<StudentGoalRow | null> {
  const { data, error } = await client
    .from("student_goals")
    .select("id, student_id, surah_start, ayah_start, surah_end, ayah_end, target_date, created_at, updated_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<StudentGoalRow[]>();
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function upsertGoal(
  client: ServerClient,
  input: Omit<StudentGoalRow, "id" | "created_at" | "updated_at">,
): Promise<void> {
  const { error } = await client
    .from("student_goals")
    .upsert(input, { onConflict: "student_id" });
  if (error) throw error;
}

async function getGoalProgressSnapshot(
  client: ServerClient,
  studentId: string,
  goal: StudentGoalRow,
  now: Date,
): Promise<GoalProgressSnapshot> {
  const paceStart = new Date(now.getTime() - PACE_WEEKS * 7 * 24 * 60 * 60 * 1000);
  const progressRangeColumns = "surah_from, ayah_from, surah_to, ayah_to";
  const [goalProgress, recentProgress] = await Promise.all([
    client.from("student_progress").select(progressRangeColumns)
      .eq("student_id", studentId).eq("progress_type", "new")
      .lte("surah_from", goal.surah_end).gte("surah_to", goal.surah_start)
      .returns<ProgressRangeRow[]>(),
    client.from("student_progress").select(progressRangeColumns)
      .eq("student_id", studentId).eq("progress_type", "new")
      .gte("created_at", paceStart.toISOString()).lte("created_at", now.toISOString())
      .returns<ProgressRangeRow[]>(),
  ]);
  if (goalProgress.error) throw goalProgress.error;
  if (recentProgress.error) throw recentProgress.error;
  return { goalRanges: goalProgress.data ?? [], recentRanges: recentProgress.data ?? [] };
}

function calculateGoalDashboardData(
  goal: StudentGoalRow,
  snapshot: GoalProgressSnapshot,
  now: Date,
): GoalDashboardData {
  const goalRange = toRange(goal);
  const memorizedAyahs = countCoveredAyahs(goalRange, snapshot.goalRanges.map(toRange));
  const wholeQuran: QuranRange = {
    surahStart: 1,
    ayahStart: 1,
    surahEnd: 114,
    ayahEnd: ayahCount(114)!,
  };
  const recentAyahs = countCoveredAyahs(wholeQuran, snapshot.recentRanges.map(toRange));
  const ayahsPerWeek = recentAyahs / PACE_WEEKS;
  const totalAyahs = totalAyahsInRange(goalRange);
  const projection = projectCompletion(memorizedAyahs, totalAyahs, ayahsPerWeek, now);
  return { ...goal, memorizedAyahs, totalAyahs, ayahsPerWeek, projectedDate: projection.projectedDate?.toISOString() ?? null };
}

export async function getGoalDashboardData(
  client: ServerClient,
  studentId: string,
  now: Date,
): Promise<GoalDashboardData | null> {
  const goal = await getActiveGoal(client, studentId);
  if (!goal) return null;
  const snapshot = await getGoalProgressSnapshot(client, studentId, goal, now);
  return calculateGoalDashboardData(goal, snapshot, now);
}
