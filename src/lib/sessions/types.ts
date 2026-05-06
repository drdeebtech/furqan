// Stage 2 helper constants for the session-modes work.
//
// Re-exports the relevant DB enum types and adds per-mode configuration
// constants used by Stage 2 room creation (and Stage 4 dashboards / Stage 5
// halaqa booking later).

import type { SessionMode, ParticipantRole, AttendanceStatus } from "@/types/database";

export type { SessionMode, ParticipantRole, AttendanceStatus };

/**
 * Maximum participants per session mode.
 *
 * - private: 1 teacher + 1 student
 * - halaqa: 1 teacher + up to 14 students (15 incl teacher); enforced
 *   in admin form validation + Daily room properties
 * - lecture: only built if Stage 7 ships in full; Daily owner-only-broadcast
 *   rooms cap higher than interactive ones — a real value will be set when
 *   the broadcast feature is built. Until then 50 is a defensive cap.
 */
export const MAX_PARTICIPANTS_BY_MODE: Record<SessionMode, number> = {
  private: 2,
  halaqa: 15,
  lecture: 50,
};

/**
 * Daily.co room "mode" string written to sessions.daily_room_mode.
 * The value drives later rendering of the join experience (private =
 * existing 1:1 page; halaqa = new group page in Stage 6; lecture =
 * deferred / external_lecture_url path).
 */
export const DAILY_ROOM_MODE_BY_MODE: Record<SessionMode, string> = {
  private: "default",
  halaqa: "group",
  lecture: "broadcast",
};

export const isPrivateMode = (m: SessionMode | null | undefined): m is "private" =>
  m === "private" || m == null;

export const isHalaqaMode = (m: SessionMode | null | undefined): m is "halaqa" =>
  m === "halaqa";

export const isLectureMode = (m: SessionMode | null | undefined): m is "lecture" =>
  m === "lecture";

export function getMaxParticipantsForMode(mode: SessionMode | null | undefined): number {
  if (!mode) return MAX_PARTICIPANTS_BY_MODE.private;
  return MAX_PARTICIPANTS_BY_MODE[mode];
}

export function getDailyRoomModeForMode(mode: SessionMode | null | undefined): string {
  if (!mode) return DAILY_ROOM_MODE_BY_MODE.private;
  return DAILY_ROOM_MODE_BY_MODE[mode];
}
