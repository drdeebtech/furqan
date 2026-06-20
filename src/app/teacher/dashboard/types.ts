import type { SessionType } from "@/types/database";

export interface PendingBooking {
  id: string;
  // Spec 022: NULL for single-session assessment/specialized bookings where
  // the slot is chosen after creation. Render as "Unscheduled" / exclude from
  // imminent-session windows.
  scheduled_at: string | null;
  duration_min: number;
  session_type: SessionType;
  amount_usd: number;
  student_id: string;
}

export interface SessionData {
  id: string;
  room_url: string;
  expires_at: string | null;
  started_at: string | null;
  ended_at: string | null;
}
