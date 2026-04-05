import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Radio, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LiveSessionsMonitor } from "./live-monitor";

export const metadata: Metadata = { title: "الجلسات النشطة" };

interface ActiveSessionRow {
  id: string;
  booking_id: string;
  started_at: string;
  teacher_joined: boolean;
  student_joined: boolean;
}

interface BookingRow {
  id: string;
  student_id: string;
  teacher_id: string;
  scheduled_at: string;
  duration_min: number;
}

export default async function LiveSessionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /* Fetch active sessions: started but not ended */
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, booking_id, started_at, teacher_joined, student_joined")
    .not("started_at", "is", null)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .returns<ActiveSessionRow[]>();

  const list = sessions ?? [];

  /* Resolve booking + names */
  let bookingMap: Record<string, BookingRow> = {};
  let nameMap: Record<string, string> = {};

  if (list.length > 0) {
    const bIds = list.map((s) => s.booking_id);
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, student_id, teacher_id, scheduled_at, duration_min")
      .in("id", bIds)
      .returns<BookingRow[]>();

    if (bookings) {
      bookingMap = Object.fromEntries(bookings.map((b) => [b.id, b]));
      const pIds = [
        ...new Set([...bookings.map((b) => b.student_id), ...bookings.map((b) => b.teacher_id)]),
      ];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", pIds)
        .returns<{ id: string; full_name: string | null }[]>();
      if (profiles) {
        nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "—"]));
      }
    }
  }

  const activeSessions = list.map((s) => {
    const b = bookingMap[s.booking_id];
    return {
      id: s.id,
      started_at: s.started_at,
      teacher_joined: s.teacher_joined,
      student_joined: s.student_joined,
      student_name: b ? nameMap[b.student_id] ?? "—" : "—",
      teacher_name: b ? nameMap[b.teacher_id] ?? "—" : "—",
      duration_min: b?.duration_min ?? 30,
      scheduled_at: b?.scheduled_at ?? s.started_at,
    };
  });

  return (
    <div dir="rtl" className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/admin/sessions"
          className="rounded-lg border border-card-border p-2 text-muted transition-colors hover:bg-surface-alt"
        >
          <ArrowRight size={16} />
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Radio size={24} className="animate-pulse text-emerald-400" />
          الجلسات النشطة
        </h1>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-400">
          {activeSessions.length}
        </span>
      </div>

      <LiveSessionsMonitor sessions={activeSessions} />
    </div>
  );
}
