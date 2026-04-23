"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { daysSince, daysUntil, scoreChurn } from "./retention-scoring";

/**
 * Retention scorer.
 *
 * Computes churn risk per student based on:
 *   - days since last session
 *   - days since last booking
 *   - remaining package sessions
 *   - days until package expiry
 *
 * Writes one row per student to `retention_signals` (upsert).
 * Intended to be invoked daily by an n8n cron workflow.
 *
 * Scoring model (0-100, higher = higher churn risk):
 *   +40 if no session in 14 days     +20 if 7-14 days
 *   +25 if no booking in 14 days     +10 if 7-14 days
 *   +20 if package_remaining == 0
 *   +15 if package expires in ≤7 days
 *   engagement_score = 100 - churn_risk_score
 */

interface StudentRow {
  id: string;
}
interface LastBookingRow {
  student_id: string;
  created_at: string;
}
interface PackageRow {
  student_id: string;
  sessions_total: number;
  sessions_used: number;
  expires_at: string | null;
}

export interface RetentionScoreResult {
  scored: number;
  highRisk: number;
  failed: number;
}

export async function scoreAllStudents(): Promise<RetentionScoreResult> {
  const supabase = createAdminClient();

  // 1. All active students
  const { data: students } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "student")
    .eq("is_active", true)
    .returns<StudentRow[]>();

  if (!students || students.length === 0) {
    return { scored: 0, highRisk: 0, failed: 0 };
  }

  const studentIds = students.map((s) => s.id);

  // 2. Last session per student (completed sessions only)
  const { data: sessions } = await supabase
    .from("sessions")
    .select("booking_id, ended_at, bookings!inner(student_id)")
    .not("ended_at", "is", null)
    .in("bookings.student_id", studentIds)
    .order("ended_at", { ascending: false })
    .returns<Array<{ ended_at: string; bookings: { student_id: string } }>>();

  const lastSessionByStudent = new Map<string, string>();
  for (const s of sessions ?? []) {
    const sid = s.bookings?.student_id;
    if (sid && !lastSessionByStudent.has(sid)) {
      lastSessionByStudent.set(sid, s.ended_at);
    }
  }

  // 3. Last booking per student
  const { data: bookings } = await supabase
    .from("bookings")
    .select("student_id, created_at")
    .in("student_id", studentIds)
    .order("created_at", { ascending: false })
    .returns<LastBookingRow[]>();

  const lastBookingByStudent = new Map<string, string>();
  for (const b of bookings ?? []) {
    if (!lastBookingByStudent.has(b.student_id)) {
      lastBookingByStudent.set(b.student_id, b.created_at);
    }
  }

  // 4. Active packages per student
  const { data: packages } = await supabase
    .from("student_packages")
    .select("student_id, sessions_total, sessions_used, expires_at")
    .in("student_id", studentIds)
    .eq("status", "active")
    .returns<PackageRow[]>();

  const packageByStudent = new Map<string, { remaining: number; expires_at: string | null }>();
  for (const p of packages ?? []) {
    const remaining = Math.max(0, p.sessions_total - p.sessions_used);
    const existing = packageByStudent.get(p.student_id);
    if (!existing || remaining > existing.remaining) {
      packageByStudent.set(p.student_id, { remaining, expires_at: p.expires_at });
    }
  }

  // 5. Compute and upsert
  const now = new Date().toISOString();
  let highRisk = 0;
  let failed = 0;
  const rows = students.map((s) => {
    const lastSessionAt = lastSessionByStudent.get(s.id) ?? null;
    const lastBookingAt = lastBookingByStudent.get(s.id) ?? null;
    const pkg = packageByStudent.get(s.id);

    const churn = scoreChurn({
      daysSinceSession: daysSince(lastSessionAt),
      daysSinceBooking: daysSince(lastBookingAt),
      packageRemaining: pkg?.remaining ?? null,
      daysUntilExpiry: daysUntil(pkg?.expires_at),
    });

    if (churn >= 60) highRisk++;

    return {
      student_id: s.id,
      last_booking_at: lastBookingAt,
      last_session_at: lastSessionAt,
      package_remaining: pkg?.remaining ?? null,
      package_expires_at: pkg?.expires_at ?? null,
      engagement_score: 100 - churn,
      churn_risk_score: churn,
      computed_at: now,
    };
  });

  // Upsert in batches of 100
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase
      .from("retention_signals")
      .upsert(batch as never, { onConflict: "student_id" });
    if (error) failed += batch.length;
  }

  return { scored: rows.length - failed, highRisk, failed };
}
