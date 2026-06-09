import type { SessionType } from "@/types/database";

export interface PendingBooking {
  id: string;
  scheduled_at: string;
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
