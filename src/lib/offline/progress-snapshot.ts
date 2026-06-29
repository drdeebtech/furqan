/**
 * Offline progress snapshot contract (#527).
 *
 * The student progress page writes this small JSON blob to localStorage on
 * every online visit; the public `/offline` page reads it back when the device
 * has no connection so a student mid-memorization can still see their assigned
 * ayahs, recent progress, and the teacher's latest note.
 *
 * Pure types + helpers, no imports — safe to use from client components on both
 * the writer (progress page) and reader (/offline) sides.
 *
 * SECURITY (#527 CR): only the student's own non-sensitive memorization data is
 * cached — ayah *references* (surah:ayah numbers), assignment titles, and dates.
 * Teacher-authored notes and parent reports are deliberately NOT cached: the
 * public /offline page reads this from localStorage, which survives logout on a
 * shared device, so anything cached here is readable by the next user. Never
 * Quran text either — that always comes from a verified source at render time
 * (CLAUDE.md §2).
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
  date: string;
}

export interface OfflineProgressSnapshot {
  /** ISO timestamp of the last successful online sync. */
  syncedAt: string;
  currentLevel: string;
  assignments: OfflineAssignment[];
  recentProgress: OfflineProgressRecord[];
}

/** Persist a snapshot. Swallows quota/availability errors — best-effort. */
export function writeProgressSnapshot(snapshot: OfflineProgressSnapshot): void {
  try {
    localStorage.setItem(PROGRESS_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode / quota — offline cache is a best-effort enhancement */
  }
}

/**
 * Shape-guard a parsed value. JSON.parse accepts any valid JSON, and an older
 * snapshot shape could be missing the arrays the /offline UI maps over —
 * returning it unchecked would crash that page instead of falling back to the
 * empty state. We validate the top-level shape (the arrays + syncedAt) rather
 * than every field: the data is self-written, so structural integrity is enough
 * to keep the reader safe. (#527 CR)
 */
function isOfflineProgressSnapshot(value: unknown): value is OfflineProgressSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.syncedAt === "string" &&
    typeof v.currentLevel === "string" &&
    Array.isArray(v.assignments) &&
    Array.isArray(v.recentProgress)
  );
}

/** Read the last snapshot, or null if none/parse-failure/shape-mismatch. */
export function readProgressSnapshot(): OfflineProgressSnapshot | null {
  try {
    const raw = localStorage.getItem(PROGRESS_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isOfflineProgressSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
