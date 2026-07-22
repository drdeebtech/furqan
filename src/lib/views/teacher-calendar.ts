import type { ServerClient } from "@/lib/supabase/types";

/**
 * Teacher calendar read module — the `/teacher/calendar` page.
 *
 * Behavior-preserving extraction from `teacher-queries.ts` (Task 4 of the
 * architecture-deepening series). The injected `supabase` client is the
 * test seam. No name-resolve or date-window literals here — purely a
 * mechanical signature change (client injected as first param).
 */

export type TeacherId = string;

// ─── Calendar events ────────────────────────────────────────────────────────

export type TeacherCalendarEventKind = "booking" | "halaqa";

export interface TeacherCalendarEvent {
  id: string;
  kind: TeacherCalendarEventKind;
  /**
   * Raw ISO timestamp (server returns UTC; client formats time + groups by
   * local-date). Pre-2026-05-06 the server formatted these into "HH:mm"
   * strings using `Date.getHours()`, which on Vercel returns UTC — every
   * non-UTC teacher saw the wrong time. Now the grid component formats
   * client-side via `toLocaleTimeString`.
   */
  isoStart: string;
  /** Title segment AFTER the time (e.g. "hifz", "Surah Al-Mulk"). */
  label: string;
  href: string;
  /** Hex color used by the grid for the event dot + text tint. */
  color: string;
}

export interface TeacherWeeklyAvailabilityRow {
  /** 0 = Sunday … 6 = Saturday (matches `Date.prototype.getDay()`). */
  dayOfWeek: number;
  totalMinutes: number;
}

export interface TeacherCalendarPayload {
  events: TeacherCalendarEvent[];
  /** Recurring weekly availability — rendered as a single summary row above
   *  the grid, NOT projected per-cell. The 2026-05-06 visual audit caught
   *  the per-cell repetition (5+ identical "14h available" chips per
   *  column) as banner-blindness. */
  weeklyAvailability: TeacherWeeklyAvailabilityRow[];
}

const COLOR_BOOKING = "#F59E0B"; // gold
const COLOR_HALAQA = "#10B981"; // emerald
const COLOR_BOOKING_NO_SHOW = "#EF4444";

/**
 * Minutes between two HH:MM strings (e.g. "14:00" → "15:30" = 90).
 * Handles only same-day windows; teacher_availability never crosses
 * midnight by convention.
 */
function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

/**
 * Unified calendar payload for /teacher/calendar — two layers:
 *
 *  1. **Bookings** (gold) + **Halaqas** (emerald) — concrete sessions, returned
 *     as raw ISO timestamps so the grid client component can format times in
 *     the teacher's local timezone.
 *  2. **weeklyAvailability** — one row per weekday with non-zero recurring
 *     availability. Surfaced ONCE in a summary row, not per-cell.
 */
export async function getTeacherCalendarEvents(
  supabase: ServerClient,
  teacherId: TeacherId,
  monthStart: Date,
  monthEnd: Date,
): Promise<TeacherCalendarPayload> {
  const startIso = monthStart.toISOString();
  const endIso = monthEnd.toISOString();

  const [bookingsRes, slotsRes, halaqaParticipantsRes] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, scheduled_at, session_type, status")
      .eq("teacher_id", teacherId)
      .gte("scheduled_at", startIso)
      .lte("scheduled_at", endIso)
      .returns<
        {
          id: string;
          scheduled_at: string;
          session_type: string;
          status: string;
        }[]
      >(),
    supabase
      .from("teacher_availability")
      .select("id, day_of_week, start_time, end_time, is_active")
      .eq("teacher_id", teacherId)
      .eq("is_active", true)
      .returns<
        {
          id: string;
          day_of_week: number;
          start_time: string;
          end_time: string;
          is_active: boolean;
        }[]
      >(),
    // Halaqas the teacher leads — read participant rows, then join sessions.
    supabase
      .from("session_participants")
      .select("session_id")
      .eq("user_id", teacherId)
      .eq("role", "teacher")
      .returns<{ session_id: string }[]>(),
  ]);
  if (bookingsRes.error) throw bookingsRes.error;
  if (slotsRes.error) throw slotsRes.error;
  if (halaqaParticipantsRes.error) throw halaqaParticipantsRes.error;

  const events: TeacherCalendarEvent[] = [];

  if (bookingsRes.data) {
    for (const b of bookingsRes.data) {
      events.push({
        id: `booking_${b.id}`,
        kind: "booking",
        isoStart: b.scheduled_at,
        label: b.session_type,
        href: `/teacher/sessions/${b.id}`,
        color:
          b.status === "no_show" ? COLOR_BOOKING_NO_SHOW : COLOR_BOOKING,
      });
    }
  }

  const halaqaIds = halaqaParticipantsRes.data
    ? halaqaParticipantsRes.data.map((r) => r.session_id)
    : [];
  if (halaqaIds.length > 0) {
    const halaqasRes = await supabase
      .from("sessions")
      .select(
        "id, scheduled_at, session_topic_ar, session_topic_en, session_mode",
      )
      .in("id", halaqaIds)
      .eq("session_mode", "halaqa")
      .gte("scheduled_at", startIso)
      .lte("scheduled_at", endIso)
      .returns<
        {
          id: string;
          scheduled_at: string | null;
          session_topic_ar: string | null;
          session_topic_en: string | null;
          session_mode: string;
        }[]
      >();
    if (halaqasRes.error) throw halaqasRes.error;
    if (halaqasRes.data) {
      for (const h of halaqasRes.data) {
        if (!h.scheduled_at) continue;
        const topic =
          h.session_topic_ar ?? h.session_topic_en ?? "Halaqa";
        events.push({
          id: `halaqa_${h.id}`,
          kind: "halaqa",
          isoStart: h.scheduled_at,
          label: topic,
          href: `/teacher/halaqas`,
          color: COLOR_HALAQA,
        });
      }
    }
  }

  // Bookings first per ISO start so the grid's 3-event-per-day cap never
  // hides a real commitment.
  const kindOrder: Record<TeacherCalendarEventKind, number> = {
    booking: 0,
    halaqa: 1,
  };
  events.sort((a, b) => {
    if (a.isoStart !== b.isoStart)
      return a.isoStart < b.isoStart ? -1 : 1;
    return kindOrder[a.kind] - kindOrder[b.kind];
  });

  // Weekly availability — collapse to one row per weekday with non-zero
  // recurring slots. Rendered as a summary row above the grid.
  const minutesByWeekday = new Map<number, number>();
  if (slotsRes.data) {
    for (const s of slotsRes.data) {
      const mins = diffMinutes(s.start_time, s.end_time);
      if (mins <= 0) continue;
      minutesByWeekday.set(
        s.day_of_week,
        (minutesByWeekday.get(s.day_of_week) ?? 0) + mins,
      );
    }
  }
  const weeklyAvailability: TeacherWeeklyAvailabilityRow[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const minutes = minutesByWeekday.get(dow);
    if (minutes && minutes > 0) {
      weeklyAvailability.push({ dayOfWeek: dow, totalMinutes: minutes });
    }
  }

  return { events, weeklyAvailability };
}
