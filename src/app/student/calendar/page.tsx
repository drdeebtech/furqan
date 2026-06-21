import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { startOfMonth, endOfMonth } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { getStudentCalendarEvents } from "@/lib/dashboard-queries";
import { CalendarGrid } from "./calendar-grid";

export const metadata: Metadata = { title: "التقويم" };

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

export default async function StudentCalendarPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  // `month` is `YYYY-MM` (e.g. "2026-04"). Default to current month.
  const now = new Date();
  let viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) {
    const [y, m] = sp.month.split("-").map(Number);
    viewMonth = new Date(y, m - 1, 1);
  }

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);

  const events = await getStudentCalendarEvents(supabase, user.id, monthStart, monthEnd);

  const todayIso = now.toISOString().slice(0, 10);

  return (
    <CalendarGrid
      monthIso={viewMonth.toISOString()}
      todayIso={todayIso}
      events={events}
    />
  );
}
