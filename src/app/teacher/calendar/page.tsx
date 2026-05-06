import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { startOfMonth, endOfMonth } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { getTeacherCalendarEvents } from "@/lib/teacher-queries";
import { TeacherCalendarGrid } from "./teacher-calendar-grid";

export const metadata: Metadata = { title: "تقويم المعلم" };

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

export default async function TeacherCalendarPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const now = new Date();
  let viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) {
    const [y, m] = sp.month.split("-").map(Number);
    viewMonth = new Date(y, m - 1, 1);
  }

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);

  const payload = await getTeacherCalendarEvents(user.id, monthStart, monthEnd);

  return (
    <TeacherCalendarGrid
      monthIso={viewMonth.toISOString()}
      events={payload.events}
      weeklyAvailability={payload.weeklyAvailability}
    />
  );
}
