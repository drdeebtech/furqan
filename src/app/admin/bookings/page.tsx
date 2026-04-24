import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { BookingStatus, SessionType } from "@/types/database";
import { BookingsTable } from "./bookings-table";

export const metadata: Metadata = { title: "إدارة الحجوزات" };

interface Row { id: string; student_id: string; teacher_id: string; scheduled_at: string; duration_min: number; status: BookingStatus; session_type: SessionType; amount_usd: number; created_at: string; }

export default async function AdminBookingsPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("bookings")
    .select("id, student_id, teacher_id, scheduled_at, duration_min, status, session_type, amount_usd, created_at")
    .order("created_at", { ascending: false }).limit(100).returns<Row[]>();
  const bookings = data ?? [];

  const allIds = [...new Set([...bookings.map(b => b.student_id), ...bookings.map(b => b.teacher_id)])];
  let nameMap: Record<string, string> = {};
  if (allIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", allIds)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><BookOpen size={24} className="text-gold" /> {t("إدارة الحجوزات", "Manage Bookings")}</h1>
      <BookingsTable bookings={bookings} nameMap={nameMap} />
    </div>
  );
}
