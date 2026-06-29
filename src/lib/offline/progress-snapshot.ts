/**
 * Offline progress snapshot contract (#527).
 *
 * The student progress page writes this small JSON blob to localStorage on
 * every online visit; the public `/offline` page reads it back when the device
 * has no connection so a student mid-memorization can still see their assigned
 * ayahs, recent progress, and the teacher's latest note.
 *
 * Pure types + helpers, no imports — safe to use from client components on both
 * the writer (progress page) and reader (/offline) sides. NOTE: only ayah
 * *references* (surah:ayah numbers) and teacher notes are stored — never Quran
 * text, which always comes from a verified source at render time (CLAUDE.md §2).
 */

export const PROGRESS_SNAPSHOT_KEY = "furqan:progress-snapshot:v1";

export interface OfflineAssignment {
  title: string;
  surah: number | null;
  ayahStart: number | null;
  ayahEnd: number | null;
  dueDate: string | null;
  status: string;
}

export interface OfflineProgressRecord {
  surahFrom: number | null;
  ayahFrom: number | null;
  surahTo: number | null;
  ayahTo: number | null;
  type: string;
  quality: number | null;
  teacherNotes: string | null;
  date: string;
}

export interface OfflineProgressSnapshot {
  /** ISO timestamp of the last successful online sync. */
  syncedAt: string;
  currentLevel: string;
  assignments: OfflineAssignment[];
  recentProgress: OfflineProgressRecord[];
  parentNote: string | null;
}

/** Persist a snapshot. Swallows quota/availability errors — best-effort. */
export function writeProgressSnapshot(snapshot: OfflineProgressSnapshot): void {
  try {
    localStorage.setItem(PROGRESS_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode / quota — offline cache is a best-effort enhancement */
  }
}

/** Read the last snapshot, or null if none/parse-failure. */
export function readProgressSnapshot(): OfflineProgressSnapshot | null {
  try {
    const raw = localStorage.getItem(PROGRESS_SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OfflineProgressSnapshot;
  } catch {
    return null;
  }
}
