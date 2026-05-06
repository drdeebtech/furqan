/**
 * Teacher-roster-scoped Supabase queries.
 *
 * Sibling to `dashboard-queries.ts` (which is page-level). This module is the
 * single source of truth for queries scoped to a teacher's roster — talqeen
 * inbox, recitation tracker, calendar events, package balances, teaching
 * hours, and roster progress aggregations.
 *
 * Every function here filters by `teacher_id = auth.uid()` (or equivalent
 * ownership) at the SQL level, so RLS plus the explicit filter give
 * defense-in-depth. Pages must never bypass this module by writing inline
 * Supabase calls — that pattern caused the duplicated-query problem in the
 * student dashboard before the existing dashboard-queries.ts consolidation.
 *
 * Functions are added incrementally per PR. Each new function lands alongside
 * its consuming page in the same PR, never as speculative scaffolding.
 */

import { createClient } from "@/lib/supabase/server";

export type TeacherId = string;

// ─── Talqeen queue ──────────────────────────────────────────────────────────

export type TalqeenFilter = "all" | "today" | "this-week" | "overdue";

export interface TalqeenQueueRow {
  id: string;
  title: string;
  studentId: string;
  studentName: string;
  audioDurationSeconds: number | null;
  readyAt: string | null;
  surahNumber: number | null;
  ayahStart: number | null;
  ayahEnd: number | null;
  /** Hours since the student marked the recording ready. NULL when readyAt is null. */
  hoursSinceReady: number | null;
  /** True when hoursSinceReady > STREAK_BREAK_RISK_HOURS — surfaces the row at the top of the list. */
  streakBreakRisk: boolean;
}

/**
 * Threshold (in hours) above which a pending talqeen submission is considered
 * a streak-break risk. A senior Quran teacher's judgment call — different
 * student levels likely deserve different cutoffs (beginners stricter than
 * advanced). Today this is a single global default; revisit once we have
 * real teacher feedback.
 *
 * TODO(human): a senior teacher should validate whether 48h is the right
 * threshold, or whether it should differ by student level / standard
 * (hifz vs. tajweed vs. talqeen). See Learning by Doing #2 in the parity
 * plan.
 */
const STREAK_BREAK_RISK_HOURS = 48;

/**
 * Full talqeen queue for the teacher's `/teacher/talqeen` page. Differs from
 * `getTeacherTalqeenInbox` (dashboard widget) by:
 *  - returning the full queue, not just the 5 most recent
 *  - supporting filter chips (today / this-week / overdue)
 *  - sorting by streak-break-risk first, then by readyAt ascending (FIFO
 *    among non-risk rows) — the pedagogical default. A truly fresh recording
 *    sits below an aging one; the student waiting longest gets graded first.
 *  - surfacing surah/ayah references so the teacher knows what to expect
 *    before pressing play
 */
export async function getTalqeenQueueForTeacher(
  teacherId: TeacherId,
  filter: TalqeenFilter = "all",
): Promise<TalqeenQueueRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("homework_assignments")
    .select(
      "id, title, student_id, audio_duration_seconds, ready_at, surah_number, ayah_start, ayah_end",
    )
    .eq("teacher_id", teacherId)
    .eq("homework_type", "recitation")
    .eq("status", "student_ready");

  // Filter chips operate on `ready_at` — when did the student finish the
  // recording. Anything before the cutoff is excluded.
  if (filter !== "all") {
    const now = Date.now();
    let cutoff: Date | null = null;
    if (filter === "today") {
      cutoff = new Date(now - 24 * 60 * 60 * 1000);
    } else if (filter === "this-week") {
      cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
    } else if (filter === "overdue") {
      // Overdue chip = anything older than the streak-break-risk threshold.
      // The page surfaces these with a red badge.
      cutoff = null;
      query = query.lt(
        "ready_at",
        new Date(now - STREAK_BREAK_RISK_HOURS * 60 * 60 * 1000).toISOString(),
      );
    }
    if (cutoff) query = query.gte("ready_at", cutoff.toISOString());
  }

  const inboxRes = await query
    .order("ready_at", { ascending: true, nullsFirst: false })
    .limit(200)
    .returns<
      {
        id: string;
        title: string;
        student_id: string;
        audio_duration_seconds: number | null;
        ready_at: string | null;
        surah_number: number | null;
        ayah_start: number | null;
        ayah_end: number | null;
      }[]
    >();
  if (inboxRes.error) throw inboxRes.error;
  const rows = inboxRes.data;
  if (!rows || rows.length === 0) return [];

  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const profilesRes = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", studentIds)
    .returns<{ id: string; full_name: string | null }[]>();
  if (profilesRes.error) throw profilesRes.error;
  const nameMap: Record<string, string> = {};
  const profiles = profilesRes.data;
  if (profiles) {
    for (const p of profiles) nameMap[p.id] = p.full_name ?? "—";
  }

  const now = Date.now();
  const enriched: TalqeenQueueRow[] = rows.map((r) => {
    const hoursSinceReady = r.ready_at
      ? (now - new Date(r.ready_at).getTime()) / (60 * 60 * 1000)
      : null;
    return {
      id: r.id,
      title: r.title,
      studentId: r.student_id,
      studentName: nameMap[r.student_id] ?? "—",
      audioDurationSeconds: r.audio_duration_seconds,
      readyAt: r.ready_at,
      surahNumber: r.surah_number,
      ayahStart: r.ayah_start,
      ayahEnd: r.ayah_end,
      hoursSinceReady,
      streakBreakRisk:
        hoursSinceReady !== null && hoursSinceReady > STREAK_BREAK_RISK_HOURS,
    };
  });

  // Streak-break-risk first, then FIFO among the rest. The DB-level order
  // already gives us FIFO; here we just hoist risk rows to the top while
  // preserving relative order via stable sort.
  enriched.sort((a, b) => {
    if (a.streakBreakRisk !== b.streakBreakRisk) {
      return a.streakBreakRisk ? -1 : 1;
    }
    return 0;
  });

  return enriched;
}

// ─── Calendar events ────────────────────────────────────────────────────────

export type TeacherCalendarEventKind = "booking" | "halaqa" | "availability";

export interface TeacherCalendarEvent {
  id: string;
  /** ISO yyyy-mm-dd. */
  date: string;
  kind: TeacherCalendarEventKind;
  title: string;
  href: string;
  /** Hex color used by the grid for the event dot + text tint. */
  color: string;
}

const COLOR_BOOKING = "#F59E0B"; // gold
const COLOR_HALAQA = "#10B981"; // emerald
const COLOR_AVAILABILITY = "#94A3B8"; // slate-400 (ghost)

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

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
 * Unified calendar event stream for /teacher/calendar — three layers:
 *
 *  1. **Bookings** (gold) — concrete 1:1 sessions with this teacher.
 *  2. **Halaqas** (emerald) — group sessions where this teacher is the
 *     `role='teacher'` participant.
 *  3. **Availability summary** (ghost) — one chip per day showing the
 *     total free hours, projected from the teacher's recurring weekly
 *     `teacher_availability` slots. Surfaces "I have capacity here"
 *     at a glance without cluttering the day cell with N hourly chips.
 *
 * Returns a flat list keyed by ISO date; the grid groups client-side.
 * Order matters — bookings first so they win the 3-event-per-cell cap.
 */
export async function getTeacherCalendarEvents(
  teacherId: TeacherId,
  monthStart: Date,
  monthEnd: Date,
): Promise<TeacherCalendarEvent[]> {
  const supabase = await createClient();
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
    // Two-step (rather than a big inner-join) so each table's RLS gates
    // independently; simpler to reason about during a CV-status edge case.
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

  // 1. Bookings — gold
  if (bookingsRes.data) {
    for (const b of bookingsRes.data) {
      events.push({
        id: `booking_${b.id}`,
        date: dateKey(b.scheduled_at),
        kind: "booking",
        title: `${fmtTime(b.scheduled_at)} · ${b.session_type}`,
        href: `/teacher/sessions/${b.id}`,
        color: b.status === "no_show" ? "#EF4444" : COLOR_BOOKING,
      });
    }
  }

  // 2. Halaqas — emerald (resolved via the participant rows fetched above)
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
          date: dateKey(h.scheduled_at),
          kind: "halaqa",
          title: `${fmtTime(h.scheduled_at)} · ${topic}`,
          href: `/teacher/halaqas`,
          color: COLOR_HALAQA,
        });
      }
    }
  }

  // 3. Availability summary — one ghost chip per matching day. Project
  // the recurring weekly slots across the visible date range and sum
  // active-slot duration per day. Surfaces "I have capacity here" without
  // littering the cell with N hour-chips.
  if (slotsRes.data && slotsRes.data.length > 0) {
    const minutesByWeekday = new Map<number, number>(); // 0..6 → total minutes
    for (const s of slotsRes.data) {
      const mins = diffMinutes(s.start_time, s.end_time);
      if (mins <= 0) continue;
      minutesByWeekday.set(
        s.day_of_week,
        (minutesByWeekday.get(s.day_of_week) ?? 0) + mins,
      );
    }
    const cursor = new Date(monthStart);
    while (cursor <= monthEnd) {
      const dow = cursor.getDay();
      const mins = minutesByWeekday.get(dow);
      if (mins && mins > 0) {
        const hours = mins / 60;
        const hoursLabel =
          hours === Math.floor(hours)
            ? hours.toFixed(0)
            : hours.toFixed(1);
        const iso = cursor.toISOString().slice(0, 10);
        events.push({
          id: `avail_${iso}`,
          date: iso,
          kind: "availability",
          title: `${hoursLabel}h available`,
          href: `/teacher/availability`,
          color: COLOR_AVAILABILITY,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Sort within each day: booking → halaqa → availability. Bookings win the
  // 3-event cap so the teacher never loses sight of a real commitment.
  const kindOrder: Record<TeacherCalendarEventKind, number> = {
    booking: 0,
    halaqa: 1,
    availability: 2,
  };
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return kindOrder[a.kind] - kindOrder[b.kind];
  });

  return events;
}

// ─── Recitation roster ──────────────────────────────────────────────────────

export interface TeacherRecitationRosterRow {
  studentId: string;
  studentName: string;
  avatarUrl: string | null;
  /** Most recent surah this student is reciting (from progress_type='new'). */
  currentSurah: number | null;
  surahFrom: number | null;
  surahTo: number | null;
  /** ISO timestamp of the most recent recorded recitation event. */
  lastHeardAt: string | null;
  daysSinceLastHeard: number | null;
  /** Average quality rating across the last 5 recorded events (0..5). */
  qualityAvgLast5: number | null;
  /** True when daysSinceLastHeard >= STREAK_BREAK_DAYS_DEFAULT. */
  streakBreakRisk: boolean;
}

/**
 * Threshold (in days) above which a student's recitation cadence is treated
 * as cold. Default 7 days globally.
 *
 * TODO(human): a senior Quran teacher should validate whether 7 days is the
 * right "going cold" cutoff, or whether the threshold should differ by
 * student level (beginner stricter than advanced) or by the configured
 * `recitation_standard`. See Learning by Doing #2 in the parity plan.
 */
const STREAK_BREAK_DAYS_DEFAULT = 7;

/**
 * Roster-lens recitation tracker for /teacher/recitations. Returns one row
 * per student the teacher is connected to, with:
 *  - their current surah (from the most recent `progress_type='new'` row)
 *  - the most recent recorded recitation event timestamp
 *  - a quality average over the last 5 events
 *  - a streak-break-risk flag when no event in N days
 *
 * Data source is `student_progress` filtered by progress_type='new'. We
 * intentionally do NOT join `homework_assignments` here — talqeen
 * submissions are surfaced on /teacher/talqeen, and mixing two definitions
 * of "last heard" muddies the mental model. This page asks: when did the
 * teacher last *record* something for this student?
 *
 * One result row per student-with-a-booking. Students without any
 * `student_progress` row still appear (with null fields) so the teacher
 * sees brand-new students that haven't been recorded yet.
 */
export async function getTeacherRecitationRoster(
  teacherId: TeacherId,
): Promise<TeacherRecitationRosterRow[]> {
  const supabase = await createClient();

  // Step 1: distinct student IDs from teacher's bookings (any status).
  const bookingsRes = await supabase
    .from("bookings")
    .select("student_id")
    .eq("teacher_id", teacherId)
    .returns<{ student_id: string }[]>();
  if (bookingsRes.error) throw bookingsRes.error;
  const bookings = bookingsRes.data;
  if (!bookings || bookings.length === 0) return [];
  const studentIds = [...new Set(bookings.map((b) => b.student_id))];

  // Step 2: parallel fetches.
  // Per-student `.limit(5)` instead of one global `.limit(N)`: a single
  // very-active student can otherwise dominate a union limit and starve
  // quieter students of any rows. With Promise.all the N+1 cost is
  // amortized in parallel; for typical rosters (5–30 students) latency
  // is unchanged. For very large rosters (100+) consider a Postgres
  // window-function RPC instead.
  type ProgressRow = {
    student_id: string;
    surah_from: number | null;
    surah_to: number | null;
    quality_rating: number | null;
    created_at: string;
  };
  const [profilesRes, ...progressResults] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", studentIds)
      .returns<
        { id: string; full_name: string | null; avatar_url: string | null }[]
      >(),
    ...studentIds.map((id) =>
      supabase
        .from("student_progress")
        .select(
          "student_id, surah_from, surah_to, quality_rating, created_at",
        )
        .eq("student_id", id)
        .eq("progress_type", "new")
        .order("created_at", { ascending: false })
        .limit(5)
        .returns<ProgressRow[]>(),
    ),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  for (const r of progressResults) {
    if (r.error) throw r.error;
  }

  const profileById = new Map<
    string,
    { name: string; avatar: string | null }
  >();
  if (profilesRes.data) {
    for (const p of profilesRes.data) {
      profileById.set(p.id, {
        name: p.full_name ?? "—",
        avatar: p.avatar_url,
      });
    }
  }

  // Map results back to students by index — Promise.all preserves order
  // matching the input array, so progressResults[i] belongs to studentIds[i].
  const progressByStudent = new Map<string, ProgressRow[]>();
  studentIds.forEach((id, i) => {
    const data = progressResults[i].data;
    progressByStudent.set(id, data ? data : []);
  });

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  return studentIds.map((id) => {
    const profile = profileById.get(id);
    const rows = progressByStudent.get(id);
    const latest = rows && rows.length > 0 ? rows[0] : null;

    let qualityAvg: number | null = null;
    if (rows && rows.length > 0) {
      const window = rows
        .slice(0, 5)
        .map((r) => r.quality_rating)
        .filter((q): q is number => typeof q === "number");
      if (window.length > 0) {
        qualityAvg =
          window.reduce((s, n) => s + n, 0) / window.length;
      }
    }

    const lastHeardAt = latest ? latest.created_at : null;
    const days = lastHeardAt
      ? Math.floor((now - new Date(lastHeardAt).getTime()) / dayMs)
      : null;

    return {
      studentId: id,
      studentName: profile?.name ?? "—",
      avatarUrl: profile?.avatar ?? null,
      currentSurah: latest?.surah_to ?? latest?.surah_from ?? null,
      surahFrom: latest?.surah_from ?? null,
      surahTo: latest?.surah_to ?? null,
      lastHeardAt,
      daysSinceLastHeard: days,
      qualityAvgLast5: qualityAvg,
      streakBreakRisk:
        days !== null && days >= STREAK_BREAK_DAYS_DEFAULT,
    };
  });
}

// ─── Teaching hours analytics ───────────────────────────────────────────────

export interface TeacherTeachingHoursSummary {
  /** Total minutes taught in the rolling last-7-day window. */
  thisWeekMinutes: number;
  /** Total minutes taught in the rolling last-30-day window. */
  thisMonthMinutes: number;
  /** Per-session-type minutes for the last-30-day window. */
  byTypeThisMonth: Record<string, number>;
  /** Daily totals for the last 30 days, oldest → newest. */
  daily: Array<{ date: string; minutes: number }>;
}

/**
 * Teaching-hours analytics for /teacher/time-tracker.
 *
 * NOT a clone of /student/time-tracker. The student tracker is a self-logged
 * stopwatch (`study_log` table). The teacher's source of truth is **completed
 * sessions** — `sessions.actual_duration` for rows whose `ended_at IS NOT
 * NULL`, joined to bookings to attribute by teacher and session_type.
 *
 * Reads only — no mutations, no migrations.
 */
export async function getTeacherTeachingHours(
  teacherId: TeacherId,
): Promise<TeacherTeachingHoursSummary> {
  const supabase = await createClient();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = new Date(now - 30 * dayMs).toISOString();
  const sevenDaysAgo = new Date(now - 7 * dayMs).toISOString();

  // Step 1: bookings owned by this teacher in the last-30 window. Defines
  // the candidate booking set + carries session_type for the breakdown.
  const bookingsRes = await supabase
    .from("bookings")
    .select("id, session_type, scheduled_at")
    .eq("teacher_id", teacherId)
    .gte("scheduled_at", thirtyDaysAgo)
    .returns<
      { id: string; session_type: string; scheduled_at: string }[]
    >();
  if (bookingsRes.error) throw bookingsRes.error;
  const bookings = bookingsRes.data;
  if (!bookings || bookings.length === 0) {
    return {
      thisWeekMinutes: 0,
      thisMonthMinutes: 0,
      byTypeThisMonth: {},
      daily: _emptyDailyWindow(now, dayMs),
    };
  }

  const bookingIds = bookings.map((b) => b.id);
  const sessionTypeByBooking = new Map<string, string>();
  for (const b of bookings) sessionTypeByBooking.set(b.id, b.session_type);

  // Step 2: completed sessions for those bookings.
  const sessionsRes = await supabase
    .from("sessions")
    .select("booking_id, actual_duration, started_at, ended_at")
    .in("booking_id", bookingIds)
    .not("ended_at", "is", null)
    .returns<
      {
        booking_id: string;
        actual_duration: number | null;
        started_at: string | null;
        ended_at: string | null;
      }[]
    >();
  if (sessionsRes.error) throw sessionsRes.error;

  let thisWeekMinutes = 0;
  let thisMonthMinutes = 0;
  const byTypeThisMonth: Record<string, number> = {};
  const dailyTotals = new Map<string, number>();

  const sessions = sessionsRes.data;
  if (sessions) {
    for (const s of sessions) {
      const minutes = s.actual_duration ?? 0;
      if (minutes <= 0) continue;
      const sessionType = sessionTypeByBooking.get(s.booking_id) ?? "other";
      const startedAt = s.started_at ?? s.ended_at;
      if (!startedAt) continue;

      thisMonthMinutes += minutes;
      byTypeThisMonth[sessionType] =
        (byTypeThisMonth[sessionType] ?? 0) + minutes;

      if (startedAt >= sevenDaysAgo) {
        thisWeekMinutes += minutes;
      }

      const day = startedAt.slice(0, 10);
      dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + minutes);
    }
  }

  // Materialize the daily window with zeros for empty days.
  const daily = _emptyDailyWindow(now, dayMs).map((entry) => ({
    date: entry.date,
    minutes: dailyTotals.get(entry.date) ?? 0,
  }));

  return {
    thisWeekMinutes,
    thisMonthMinutes,
    byTypeThisMonth,
    daily,
  };
}

function _emptyDailyWindow(
  now: number,
  dayMs: number,
): Array<{ date: string; minutes: number }> {
  const out: Array<{ date: string; minutes: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    out.push({ date: d.toISOString().slice(0, 10), minutes: 0 });
  }
  return out;
}
