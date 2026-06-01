/**
 * Follow-up domain — types & error classes (ADR-0002 shape).
 *
 * Domain language note (CONTEXT.md): the user-facing term is
 * "follow-up" / "متابعة". The DB table `homework_assignments` and its
 * column names are internal and stay as-is — we do NOT rename columns.
 *
 * Per ADR-0002:
 * - Domain functions take **structured, already-authenticated input** —
 *   no FormData, no Supabase session. The route adapter parses FormData
 *   and resolves the actor (authentication + role) before calling.
 * - Domain functions **throw** on failure; the route adapter (wrapped in
 *   `loudAction`) catches the throw and shapes the unified
 *   `{ ok, error?, message? }` response.
 * - Errors are domain-meaningful subclasses so adapters can map them to
 *   user-facing Arabic copy without inspecting message strings.
 */

import type { HomeworkStatus } from "@/types/database";
import type { ReviewHorizon } from "@/lib/constants";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

/**
 * The authenticated actor performing a follow-up write. The route adapter
 * resolves this (Supabase session + role lookup) before calling the
 * domain. `isAdmin` lets the domain apply the existing
 * "teacher-owns-the-row OR admin-bypass" authorization uniformly without
 * re-reading `profiles.role` per call.
 */
export interface FollowUpActor {
  id: string;
  isAdmin: boolean;
}

// ─── createFollowUp ──────────────────────────────────────────────────────────

/**
 * Structured input for `createFollowUp` (the `homework.assigned`
 * lifecycle entry). Field names mirror the `homework_assignments`
 * columns so the insert stays one-to-one.
 */
export interface CreateFollowUpInput {
  bookingId: string;
  studentId: string;
  sessionId: string | null;
  homeworkType: string;
  title: string;
  description: string | null;
  surahNumber: number | null;
  ayahStart: number | null;
  ayahEnd: number | null;
  pagesCount: number | null;
  dueDate: string | null;
  reviewHorizon: ReviewHorizon;
}

/** Result of a successful `createFollowUp`. */
export interface CreateFollowUpResult {
  studentId: string;
  bookingId: string;
}

// ─── markStudentReady ────────────────────────────────────────────────────────

/**
 * Optional audio submission attached atomically when the student marks a
 * follow-up ready. `path` is the storage object path; `durationSeconds`
 * is validated (1–300s) in the domain.
 */
export interface FollowUpAudio {
  path: string;
  durationSeconds: number;
}

/** Structured input for `markStudentReady`. */
export interface MarkStudentReadyInput {
  followUpId: string;
  audio: FollowUpAudio | null;
}

/** Result of a successful `markStudentReady` — carries ids for the event. */
export interface MarkStudentReadyResult {
  followUpId: string;
  studentId: string;
  teacherId: string;
}

// ─── gradeFollowUp ───────────────────────────────────────────────────────────

/** Structured input for `gradeFollowUp`. */
export interface GradeFollowUpInput {
  followUpId: string;
  grade: HomeworkStatus;
  teacherNotes: string | null;
}

/** Result of a successful `gradeFollowUp` — ids + grade for the event. */
export interface GradeFollowUpResult {
  followUpId: string;
  studentId: string;
  teacherId: string;
  grade: HomeworkStatus;
}

// ─── editFollowUp ────────────────────────────────────────────────────────────

/** Structured input for `editFollowUp`. */
export interface EditFollowUpInput {
  followUpId: string;
  updates: TableUpdate<"homework_assignments">;
}

/** Result of a successful `editFollowUp`. */
export interface EditFollowUpResult {
  followUpId: string;
}

// ─── deleteFollowUp ──────────────────────────────────────────────────────────

/** Structured input for `deleteFollowUp`. */
export interface DeleteFollowUpInput {
  followUpId: string;
}

/** Result of a successful `deleteFollowUp` — carries the cascade size. */
export interface DeleteFollowUpResult {
  followUpId: string;
  cascadedChildren: number;
}

// ─── bulkGradeFollowUp ───────────────────────────────────────────────────────

/** The four UI grade keys the admin bulk-grade screen posts. */
export type GradeKey = "excellent" | "good" | "needs_work" | "not_done";

/** One row in a bulk-grade request. */
export interface BulkGradeItem {
  id: string;
  grade: GradeKey;
  feedback?: string | null;
}

/** Aggregate outcome of a bulk-grade run (partial success is expected). */
export interface BulkGradeResult {
  graded: number;
  failed: number;
  errors: string[];
}

// ─── Error classes ───────────────────────────────────────────────────────────

/**
 * Thrown for a pure authorization/validation failure — the actor isn't
 * allowed to touch this row, a required field is missing, or the row is
 * in the wrong state. Carries the `userError` duck-type flag so the
 * `loudAction` wrapper treats it as a user-facing message (no Sentry /
 * Telegram / FAILED-audit), matching the legacy `UserError` behavior.
 */
export class FollowUpUserError extends Error {
  readonly userError = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FollowUpUserError";
  }
}

/**
 * Thrown when the follow-up row doesn't exist (PGRST116) or a real infra
 * error blocks the lookup. When `cause` is attached the `loudAction`
 * wrapper routes the underlying error to Sentry; the user still sees the
 * friendly Arabic message. Mirrors `notFoundOrInfra` semantics.
 */
export class FollowUpNotFoundError extends FollowUpUserError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FollowUpNotFoundError";
  }
}
