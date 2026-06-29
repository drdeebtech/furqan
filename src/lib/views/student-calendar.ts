// Calendar read for /student/calendar — combines bookings, follow-up due
// dates, package expiries, and evaluation periods. Migrated out of the legacy
// dashboard-queries.ts god module (#613). Injected-client test seam.

import type { ServerClient } from "@/lib/supabase/types";

/**
 * Calendar events for /student/calendar — combines bookings, follow-up due
 * dates, package expiries, and evaluation periods into a single
 * date-keyed list scoped to a month window. Returns one row per event;
 * the calendar grid groups them by date client-side.
 */
export type CalendarEvent = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: "session" | "homework" | "package_expiry" | "evaluation";
  title: string;
  href: string;
  color: string; // tailwind palette token (passed inline as hex)
};


export async function getStudentCalendarEvents(
  supabase: ServerClient,
  studentId: string,
  monthStart: Date,
  monthEnd: Date,
): Promise<CalendarEvent[]> {
  const startIso = monthStart.toISOString();
  const endIso = monthEnd.toISOString();

  const [bookingsRes, homeworkRes, packagesRes, evalsRes] = await Promise.all([
    supabase.from("bookings")
      .select("id, scheduled_at, session_type, status")
      .eq("student_id", studentId)
      .gte("scheduled_at", startIso).lte("scheduled_at", endIso)
      .returns<{ id: string; scheduled_at: string; session_type: string; status: string }[]>(),
    supabase.from("homework_assignments")
      .select("id, due_date, status")
      .eq("student_id", studentId)
      .not("due_date", "is", null)
      .gte("due_date", startIso).lte("due_date", endIso)
      .returns<{ id: string; due_date: string | null; status: string }[]>(),
    supabase.from("student_packages")
      .select("id, expires_at, status")
      .eq("student_id", studentId)
      .not("expires_at", "is", null)
      .gte("expires_at", startIso).lte("expires_at", endIso)
      .returns<{ id: string; expires_at: string | null; status: string }[]>(),
    supabase.from("session_evaluations")
      .select("id, evaluation_date, evaluation_type")
      .eq("student_id", studentId)
      .gte("evaluation_date", startIso).lte("evaluation_date", endIso)
      .returns<{ id: string; evaluation_date: string; evaluation_type: string }[]>(),
  ]);

  const events: CalendarEvent[] = [];
  const day = (iso: string) => iso.slice(0, 10);

  for (const b of bookingsRes.data ?? []) {
    events.push({
      id: `booking_${b.id}`,
      date: day(b.scheduled_at),
      kind: "session",
      title: b.session_type,
      href: `/student/sessions`,
      color: b.status === "completed" ? "#10B981" : b.status === "no_show" ? "#EF4444" : "#3B82F6",
    });
  }
  for (const h of homeworkRes.data ?? []) {
    if (!h.due_date) continue;
    events.push({
      id: `hw_${h.id}`,
      date: day(h.due_date),
      kind: "homework",
      title: h.status === "assigned" ? "Follow-up due" : `Follow-up (${h.status})`,
      href: "/student/follow-up",
      color: "#F59E0B",
    });
  }
  for (const p of packagesRes.data ?? []) {
    if (!p.expires_at) continue;
    events.push({
      id: `pkg_${p.id}`,
      date: day(p.expires_at),
      kind: "package_expiry",
      title: "Package expires",
      href: "/student/dashboard",
      color: "#8B5CF6",
    });
  }
  for (const e of evalsRes.data ?? []) {
    events.push({
      id: `eval_${e.id}`,
      date: day(e.evaluation_date),
      kind: "evaluation",
      title: `Evaluation (${e.evaluation_type})`,
      href: "/student/progress",
      color: "#06B6D4",
    });
  }

  return events;
}

