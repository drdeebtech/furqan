// ─── Enums (Postgres ENUM types) ─────────────────────────────────────────────

export type UserRole = "student" | "teacher" | "admin" | "moderator";
export type GenderType = "male" | "female";
export type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
export type SessionType = "hifz" | "muraja" | "tajweed" | "tilawa" | "qiraat" | "tafsir" | "combined" | "other";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";
export type MsgType = "text" | "audio" | "file";
export type NotifType = "booking" | "payment" | "message" | "reminder" | "system";
export type StudentLevel = "beginner" | "intermediate" | "advanced";

// ─── V9 new enums ───────────────────────────────────────────────────────────

export type CvStatus = "draft" | "pending_review" | "approved" | "rejected";
export type EvaluationType = "weekly" | "biweekly" | "monthly" | "quarterly";
export type ReportType = "session_summary" | "evaluation" | "custom" | "missed_session" | "schedule_change";

// ─── Text CHECK unions (not Postgres ENUMs, but typed for safety) ────────────

export type ConversationStatus = "active" | "archived";
export type CreditSource = "purchase" | "refund" | "gift" | "admin";
export type ProgressType = "new" | "muraja" | "correction";
export type RecitationErrorType = "makharij" | "sifat" | "madd" | "waqf" | "ghunna" | "other";
export type TransactionType = "charge" | "refund" | "adjustment";
export type SessionCreatedVia = "webhook" | "manual" | "auto";
export type AuditAction = "INSERT" | "UPDATE" | "DELETE";
export type RecitationStandard = "hafs" | "warsh" | "qalon" | "al_duri" | "shu_ba";

// ─── Table 1: profiles ───────────────────────────────────────────────────────

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  country: string | null;
  timezone: string;
  lang: string;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // V9: parent/guardian fields
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  date_of_birth: string | null;
}

// ─── Table 2: teacher_profiles ───────────────────────────────────────────────

export interface TeacherProfile {
  id: string;
  teacher_id: string;
  bio: string | null;
  specialties: string[];
  recitation_standards: string[];
  languages: string[];
  hourly_rate: number;
  gender: GenderType | null;
  intro_video_url: string | null;
  max_active_students: number | null;
  rating_avg: number;
  total_sessions: number;
  is_accepting: boolean;
  is_archived: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // V9: CV workflow fields
  cv_status: CvStatus;
  cv_submitted_at: string | null;
  cv_reviewed_by: string | null;
  cv_reviewed_at: string | null;
  cv_rejection_reason: string | null;
}

// ─── Table 3: teacher_ijaza ──────────────────────────────────────────────────

export interface TeacherIjaza {
  id: string;
  teacher_id: string;
  riwaya: RecitationStandard;
  chain_text: string;
  granted_by: string | null;
  granted_at: string | null;
  document_url: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
}

// ─── Table 4: refund_policies ────────────────────────────────────────────────

export interface RefundPolicy {
  id: string;
  hours_before_min: number;
  hours_before_max: number | null;
  refund_percentage: number;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

// ─── Table 5: payments ───────────────────────────────────────────────────────

export interface Payment {
  id: string;
  booking_id: string | null;
  student_id: string;
  stripe_payment_intent: string;
  amount_usd: number;
  amount_local: number | null;
  local_currency: string | null;
  exchange_rate_snapshot: number | null;
  amount_before_tax: number;
  tax_rate: number;
  tax_amount: number;
  revenue_recognized: number;
  status: PaymentStatus;
  paid_at: string | null;
  created_at: string;
}

// ─── Table 6: payment_transactions ───────────────────────────────────────────

export interface PaymentTransaction {
  id: string;
  payment_id: string;
  type: TransactionType;
  amount_usd: number;
  stripe_id: string | null;
  description: string | null;
  created_at: string;
}

// ─── Table 7: student_credits ────────────────────────────────────────────────

export interface StudentCredit {
  id: string;
  student_id: string;
  teacher_id: string | null;
  total: number;
  used: number;
  // remaining is NEVER stored — compute as (total - used) in queries
  credit_value_usd: number | null;
  expires_at: string | null;
  source: CreditSource;
  payment_id: string | null;
  created_at: string;
}

// ─── Table 8: teacher_availability ───────────────────────────────────────────

export interface TeacherAvailability {
  id: string;
  teacher_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration: number;
  is_active: boolean;
  // NO created_at or updated_at on this table
}

// ─── Table 9: availability_exceptions ────────────────────────────────────────

export interface AvailabilityException {
  id: string;
  teacher_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_blocked: boolean;
  reason: string | null;
  created_at: string;
}

// ─── Table 10: bookings ──────────────────────────────────────────────────────

export interface Booking {
  id: string;
  student_id: string;
  teacher_id: string;
  created_by: string | null;
  rescheduled_from: string | null;
  refund_policy_id: string | null;
  scheduled_at: string;
  duration_min: number;
  status: BookingStatus;
  session_type: SessionType;
  rate_snapshot: number;
  amount_usd: number;
  amount_local: number | null;
  local_currency: string | null;
  exchange_rate: number | null;
  tax_rate: number;
  tax_amount: number;
  notes: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  deleted_at: string | null;
  created_at: string;
  // V9: teacher confirmation fields
  teacher_confirmed: boolean;
  teacher_confirmed_at: string | null;
  decline_reason: string | null;
}

// ─── Table 11: sessions ──────────────────────────────────────────────────────

export interface Session {
  id: string;
  booking_id: string;
  room_name: string;
  room_url: string;
  expires_at: string | null;
  created_via: SessionCreatedVia;
  started_at: string | null;
  ended_at: string | null;
  actual_duration: number | null;
  recording_url: string | null;
  teacher_joined: boolean;
  student_joined: boolean;
  post_session_notes: string | null;
  homework: string | null;
  created_at: string;
  // V9: observation fields
  admin_observer_id: string | null;
  is_observable: boolean;
  observer_joined_at: string | null;
  observer_notes: string | null;
}

// ─── Table 12: conversations ─────────────────────────────────────────────────

export interface Conversation {
  id: string;
  student_id: string;
  teacher_id: string;
  initiated_by: string;
  status: ConversationStatus;
  last_message_at: string | null;
  created_at: string;
}

// ─── Table 13: messages ──────────────────────────────────────────────────────

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  msg_type: MsgType;
  file_url: string | null;
  is_read: boolean;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

// ─── Table 14: student_progress ──────────────────────────────────────────────

export interface StudentProgress {
  id: string;
  student_id: string;
  teacher_id: string;
  booking_id: string;
  progress_type: ProgressType;
  surah_from: number | null;
  ayah_from: number | null;
  surah_to: number | null;
  ayah_to: number | null;
  pages_reviewed: number | null;
  quality_rating: number | null;
  level: StudentLevel;
  teacher_notes: string | null;
  created_at: string;
}

// ─── Table 15: recitation_errors ─────────────────────────────────────────────

export interface RecitationError {
  id: string;
  progress_id: string;
  surah_num: number | null;
  ayah_num: number;
  error_type: RecitationErrorType;
  note: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

// ─── Table 16: reviews ───────────────────────────────────────────────────────

export interface Review {
  id: string;
  booking_id: string;
  student_id: string;
  teacher_id: string;
  rating: number;
  comment: string | null;
  teacher_reply: string | null;
  is_public: boolean;
  created_at: string;
}

// ─── Table 17: notifications ─────────────────────────────────────────────────

export interface Notification {
  id: string;
  user_id: string;
  type: NotifType;
  channel: string[];
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  is_read: boolean;
  expires_at: string | null;
  created_at: string;
}

// ─── Table 18: invoices ──────────────────────────────────────────────────────

export interface Invoice {
  id: string;
  payment_id: string;
  student_id: string;
  invoice_number: string;
  issued_at: string;
  pdf_url: string | null;
  student_name_snapshot: string;
  amount_usd: number;
  tax_amount: number;
  currency: string;
  exchange_rate_snapshot: number | null;
  created_at: string;
}

// ─── Table 19: audit_log ─────────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  changed_by: string | null;
  table_name: string;
  record_id: string;
  action: AuditAction;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  reason: string | null;
  ip_address: string | null;
  created_at: string;
}

// ─── Table 20: schema_migrations ─────────────────────────────────────────────

export interface SchemaMigration {
  version: string;
  applied_at: string;
  description: string | null;
  applied_by: string | null;
}

// ─── V9 Table: platform_settings ─────────────────────────────────────────────

export interface PlatformSetting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
}

// ─── V9 Table: session_evaluations ───────────────────────────────────────────

export interface SessionEvaluation {
  id: string;
  student_id: string;
  teacher_id: string;
  evaluator_id: string;
  evaluation_type: EvaluationType;
  period_start: string;
  period_end: string;
  hifz_score: number | null;
  tajweed_score: number | null;
  akhlaq_score: number | null;
  attendance_score: number | null;
  overall_score: number | null;
  strengths: string | null;
  weaknesses: string | null;
  recommendations: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── V9 Table: parent_reports ────────────────────────────────────────────────

export interface ParentReport {
  id: string;
  student_id: string;
  teacher_id: string | null;
  report_type: ReportType;
  title: string;
  body: string;
  sent_to_email: string | null;
  sent_to_phone: string | null;
  sent_at: string | null;
  created_by: string;
  created_at: string;
}

// ─── V9 Table: session_notes_history ─────────────────────────────────────────

export interface SessionNotesHistory {
  id: string;
  session_id: string;
  notes: string;
  saved_by: string;
  created_at: string;
}

// ─── V9 Table: session_observers ─────────────────────────────────────────────

export interface SessionObserver {
  id: string;
  session_id: string;
  observer_id: string;
  joined_at: string | null;
  left_at: string | null;
  notes: string | null;
  created_at: string;
}

// ─── Supabase Database Type ──────────────────────────────────────────────────
// Row   = what you read back from a SELECT
// Insert = what you send to an INSERT (auto-generated fields are optional)
// Update = what you send to an UPDATE (everything optional except PK excluded)
// Relationships = FK metadata (empty until supabase gen types populates it)

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
          parent_name?: string | null;
          parent_phone?: string | null;
          parent_email?: string | null;
          date_of_birth?: string | null;
        };
        Update: Partial<Omit<Profile, "id">>;
        Relationships: [];
      };
      teacher_profiles: {
        Row: TeacherProfile;
        Insert: Omit<
          TeacherProfile,
          "id" | "rating_avg" | "total_sessions" | "created_at" | "updated_at" | "cv_status" | "cv_submitted_at" | "cv_reviewed_by" | "cv_reviewed_at" | "cv_rejection_reason"
        > & {
          id?: string;
          rating_avg?: number;
          total_sessions?: number;
          created_at?: string;
          updated_at?: string;
          cv_status?: CvStatus;
          cv_submitted_at?: string | null;
          cv_reviewed_by?: string | null;
          cv_reviewed_at?: string | null;
          cv_rejection_reason?: string | null;
        };
        Update: Partial<Omit<TeacherProfile, "id">>;
        Relationships: [];
      };
      teacher_ijaza: {
        Row: TeacherIjaza;
        Insert: Omit<TeacherIjaza, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<TeacherIjaza, "id">>;
        Relationships: [];
      };
      refund_policies: {
        Row: RefundPolicy;
        Insert: Omit<RefundPolicy, "id" | "is_active" | "sort_order" | "created_at"> & {
          id?: string;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Omit<RefundPolicy, "id">>;
        Relationships: [];
      };
      payments: {
        Row: Payment;
        Insert: Omit<
          Payment,
          "id" | "amount_before_tax" | "tax_rate" | "tax_amount" | "revenue_recognized" | "status" | "created_at"
        > & {
          id?: string;
          amount_before_tax?: number;
          tax_rate?: number;
          tax_amount?: number;
          revenue_recognized?: number;
          status?: PaymentStatus;
          created_at?: string;
        };
        Update: Partial<Omit<Payment, "id">>;
        Relationships: [];
      };
      payment_transactions: {
        Row: PaymentTransaction;
        Insert: Omit<PaymentTransaction, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<PaymentTransaction, "id">>;
        Relationships: [];
      };
      student_credits: {
        Row: StudentCredit;
        Insert: Omit<StudentCredit, "id" | "used" | "created_at"> & {
          id?: string;
          used?: number;
          created_at?: string;
        };
        Update: Partial<Omit<StudentCredit, "id">>;
        Relationships: [];
      };
      teacher_availability: {
        Row: TeacherAvailability;
        Insert: Omit<TeacherAvailability, "id" | "slot_duration" | "is_active"> & {
          id?: string;
          slot_duration?: number;
          is_active?: boolean;
        };
        Update: Partial<Omit<TeacherAvailability, "id">>;
        Relationships: [];
      };
      availability_exceptions: {
        Row: AvailabilityException;
        Insert: Omit<AvailabilityException, "id" | "is_blocked" | "created_at"> & {
          id?: string;
          is_blocked?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<AvailabilityException, "id">>;
        Relationships: [];
      };
      bookings: {
        Row: Booking;
        Insert: Omit<
          Booking,
          "id" | "status" | "session_type" | "tax_rate" | "tax_amount" | "created_at" | "teacher_confirmed" | "teacher_confirmed_at" | "decline_reason"
        > & {
          id?: string;
          status?: BookingStatus;
          session_type?: SessionType;
          tax_rate?: number;
          tax_amount?: number;
          created_at?: string;
          teacher_confirmed?: boolean;
          teacher_confirmed_at?: string | null;
          decline_reason?: string | null;
        };
        Update: Partial<Omit<Booking, "id">>;
        Relationships: [];
      };
      sessions: {
        Row: Session;
        Insert: Omit<
          Session,
          "id" | "room_name" | "created_via" | "teacher_joined" | "student_joined" | "created_at" | "admin_observer_id" | "is_observable" | "observer_joined_at" | "observer_notes"
        > & {
          id?: string;
          room_name?: string;
          created_via?: SessionCreatedVia;
          teacher_joined?: boolean;
          student_joined?: boolean;
          created_at?: string;
          admin_observer_id?: string | null;
          is_observable?: boolean;
          observer_joined_at?: string | null;
          observer_notes?: string | null;
        };
        Update: Partial<Omit<Session, "id">>;
        Relationships: [];
      };
      conversations: {
        Row: Conversation;
        Insert: Omit<Conversation, "id" | "status" | "created_at"> & {
          id?: string;
          status?: ConversationStatus;
          created_at?: string;
        };
        Update: Partial<Omit<Conversation, "id">>;
        Relationships: [];
      };
      messages: {
        Row: Message;
        Insert: Omit<Message, "id" | "msg_type" | "is_read" | "created_at"> & {
          id?: string;
          msg_type?: MsgType;
          is_read?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<Message, "id">>;
        Relationships: [];
      };
      student_progress: {
        Row: StudentProgress;
        Insert: Omit<StudentProgress, "id" | "progress_type" | "level" | "created_at"> & {
          id?: string;
          progress_type?: ProgressType;
          level?: StudentLevel;
          created_at?: string;
        };
        Update: Partial<Omit<StudentProgress, "id">>;
        Relationships: [];
      };
      recitation_errors: {
        Row: RecitationError;
        Insert: Omit<RecitationError, "id" | "resolved" | "created_at"> & {
          id?: string;
          resolved?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<RecitationError, "id">>;
        Relationships: [];
      };
      reviews: {
        Row: Review;
        Insert: Omit<Review, "id" | "is_public" | "created_at"> & {
          id?: string;
          is_public?: boolean;
          created_at?: string;
        };
        Update: Partial<Omit<Review, "id">>;
        Relationships: [];
      };
      notifications: {
        Row: Notification;
        Insert: Omit<Notification, "id" | "channel" | "is_read" | "expires_at" | "created_at"> & {
          id?: string;
          channel?: string[];
          is_read?: boolean;
          expires_at?: string;
          created_at?: string;
        };
        Update: Partial<Omit<Notification, "id">>;
        Relationships: [];
      };
      invoices: {
        Row: Invoice;
        Insert: Omit<Invoice, "id" | "invoice_number" | "issued_at" | "tax_amount" | "created_at"> & {
          id?: string;
          invoice_number?: string;
          issued_at?: string;
          tax_amount?: number;
          created_at?: string;
        };
        Update: Partial<Omit<Invoice, "id">>;
        Relationships: [];
      };
      audit_log: {
        Row: AuditLog;
        Insert: Omit<AuditLog, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<AuditLog, "id">>;
        Relationships: [];
      };
      schema_migrations: {
        Row: SchemaMigration;
        Insert: Omit<SchemaMigration, "applied_at"> & {
          applied_at?: string;
        };
        Update: Partial<SchemaMigration>;
        Relationships: [];
      };
      // V9 tables
      platform_settings: {
        Row: PlatformSetting;
        Insert: PlatformSetting;
        Update: Partial<PlatformSetting>;
        Relationships: [];
      };
      session_evaluations: {
        Row: SessionEvaluation;
        Insert: Omit<SessionEvaluation, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<SessionEvaluation, "id">>;
        Relationships: [];
      };
      parent_reports: {
        Row: ParentReport;
        Insert: Omit<ParentReport, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ParentReport, "id">>;
        Relationships: [];
      };
      session_notes_history: {
        Row: SessionNotesHistory;
        Insert: Omit<SessionNotesHistory, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<SessionNotesHistory, "id">>;
        Relationships: [];
      };
      session_observers: {
        Row: SessionObserver;
        Insert: Omit<SessionObserver, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<SessionObserver, "id">>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_moderator: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      is_admin_or_mod: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      gender_type: GenderType;
      booking_status: BookingStatus;
      session_type: SessionType;
      payment_status: PaymentStatus;
      msg_type: MsgType;
      notif_type: NotifType;
      student_level: StudentLevel;
      cv_status: CvStatus;
      evaluation_type: EvaluationType;
      report_type: ReportType;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
