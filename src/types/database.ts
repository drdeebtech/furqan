// Single source of truth for database types.
//
// This file is now a thin re-export layer over supabase.generated.ts (which is
// auto-regenerated from the live schema by `npm run db:types`). All consumers
// continue to import from "@/types/database" — same names, same shapes — but
// the actual definitions come from the generator. Drift between TS types and
// the live schema is no longer possible because we never hand-author column
// shapes here.
//
// To regenerate: `npm run db:types` after applying any migration. CI enforces
// freshness via .github/workflows/db-types-fresh.yml.

import type { Database } from "./supabase.generated";

export type { Database };

// ─── Postgres native enum types ─────────────────────────────────────────────
// These come from `CREATE TYPE ... AS ENUM (...)` in v9_001_schema.sql.
// They appear in Database["public"]["Enums"] because they're real pg_enum entries.

export type BookingStatus = Database["public"]["Enums"]["booking_status"];
export type CvStatus = Database["public"]["Enums"]["cv_status"];
export type EvaluationType = Database["public"]["Enums"]["evaluation_type"];
export type GenderType = Database["public"]["Enums"]["gender_type"];
export type HomeworkStatus = Database["public"]["Enums"]["homework_status"];
export type HomeworkType = Database["public"]["Enums"]["homework_type"];
export type MsgType = Database["public"]["Enums"]["msg_type"];
export type NotifType = Database["public"]["Enums"]["notif_type"];
export type PaymentStatus = Database["public"]["Enums"]["payment_status"];
export type ReportType = Database["public"]["Enums"]["report_type"];
export type SessionType = Database["public"]["Enums"]["session_type"];
export type StudentLevel = Database["public"]["Enums"]["student_level"];
export type UserRole = Database["public"]["Enums"]["user_role"];

// ─── Text-CHECK enum types ──────────────────────────────────────────────────
// These columns are TEXT with CHECK constraints (per CLAUDE.md), not pg_enum,
// so the generator can't see them. Kept hand-authored — must match the CHECKs
// in the migration files. If you add/remove a value here, also update the CHECK.

export type RecitationStandard = "hafs" | "warsh" | "qalon" | "al_duri" | "shu_ba";
export type PackageType = "single_session" | "pack_4" | "pack_8" | "pack_12" | "full_course";
export type StudentPackageStatus = "active" | "expired" | "cancelled";
export type ConversationStatus = "active" | "archived";
export type CreditSource = "purchase" | "refund" | "gift" | "admin";
export type ProgressType = "new" | "muraja" | "correction";
export type RecitationErrorType = "makharij" | "sifat" | "madd" | "waqf" | "ghunna" | "other";
export type TransactionType = "charge" | "refund" | "adjustment";
export type SessionCreatedVia = "webhook" | "manual" | "auto";
export type AuditAction = "INSERT" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT";
export type AnnouncementSeverity = "info" | "warning" | "critical";
export type CoursePricingType = "free" | "one_time";
export type CourseStatus = "draft" | "pending_review" | "published" | "archived" | "rejected";
export type CourseLevel = "beginner" | "intermediate" | "advanced";
export type CourseLanguage = "ar" | "en" | "both";
export type CourseCurrency = "USD" | "EGP";
export type CourseLessonVideoStatus = "pending" | "uploading" | "processing" | "ready" | "failed";
export type CourseEnrollmentSource = "free" | "purchase" | "admin_grant";
export type CourseReviewStatus = "published" | "hidden";
export type CoursePayoutStatus = "pending" | "paid";

// ─── Table row types ────────────────────────────────────────────────────────
// Each alias points at the generated Row type for that table — so adding/
// renaming a column in Postgres flows through after `npm run db:types`.
// PascalCase aliases keep existing imports stable.

type T = Database["public"]["Tables"];

export type Profile = T["profiles"]["Row"];
export type TeacherProfile = T["teacher_profiles"]["Row"];
export type TeacherIjaza = T["teacher_ijaza"]["Row"];
export type RefundPolicy = T["refund_policies"]["Row"];
export type Payment = T["payments"]["Row"];
export type PaymentTransaction = T["payment_transactions"]["Row"];
export type StudentCredit = T["student_credits"]["Row"];
export type TeacherAvailability = T["teacher_availability"]["Row"];
export type AvailabilityException = T["availability_exceptions"]["Row"];
export type Booking = T["bookings"]["Row"];
export type Session = T["sessions"]["Row"];
export type Conversation = T["conversations"]["Row"];
export type Message = T["messages"]["Row"];
export type StudentProgress = T["student_progress"]["Row"];
export type RecitationError = T["recitation_errors"]["Row"];
export type Review = T["reviews"]["Row"];
export type Notification = T["notifications"]["Row"];
export type Invoice = T["invoices"]["Row"];
export type AuditLog = T["audit_log"]["Row"];
export type SchemaMigration = T["schema_migrations"]["Row"];
export type PlatformSetting = T["platform_settings"]["Row"];
export type SessionEvaluation = T["session_evaluations"]["Row"];
export type ParentReport = T["parent_reports"]["Row"];
export type SessionNotesHistory = T["session_notes_history"]["Row"];
export type SessionObserver = T["session_observers"]["Row"];
export type HomeworkAssignment = T["homework_assignments"]["Row"];
export type Package = T["packages"]["Row"];
export type StudentPackage = T["student_packages"]["Row"];
export type AutomationLog = T["automation_logs"]["Row"];
export type MessageDeliveryLog = T["message_delivery_log"]["Row"];
export type CommunicationPreference = T["communication_preferences"]["Row"];
export type RetentionSignal = T["retention_signals"]["Row"];
export type SiteAnnouncement = T["site_announcements"]["Row"];
export type AutomationDeadLetter = T["automation_dead_letter"]["Row"];
export type SessionPresenceEvent = T["session_presence_events"]["Row"];
export type Course = T["courses"]["Row"];
export type CourseLesson = T["course_lessons"]["Row"];
export type CourseEnrollment = T["course_enrollments"]["Row"];
export type CourseLessonProgress = T["course_lesson_progress"]["Row"];
export type CourseReview = T["course_reviews"]["Row"];
export type CoursePayout = T["course_payouts"]["Row"];
