export interface TeacherRow {
  teacher_id: string;
  hourly_rate: number;
  rating_avg: number;
  total_sessions: number;
  is_accepting: boolean;
  is_archived: boolean;
}

export interface PendingBookingRow {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  session_type: string;
  created_at: string;
}

export interface TodayBookingRow {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  session_type: string;
  status: string;
  duration_min: number;
}

export interface RevenueRow {
  amount_usd: number;
}
