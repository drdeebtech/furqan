import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { getT } from "@/lib/i18n/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { SearchInput } from "@/components/shared/search-input";
import type { BookingStatus, SessionType } from "@/types/database";
import { BookingsTable } from "./bookings-table";

export const metadata: Metadata = { title: "إدارة الحجوزات" };

interface Row { id: string; student_id: string; teacher_id: string; scheduled_at: string; duration_min: number; status: BookingStatus; session_type: SessionType; amount_usd: number; created_at: string; }

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function AdminBookingsPage({ searchParams }: PageProps) {
  const { t, dir } = await getT();
  const { q = "" } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error: bookingsError } = await supabase.from("bookings")
    .select("id, student_id, teacher_id, scheduled_at, duration_min, status, session_type, amount_usd, created_at")
    .order("created_at", { ascending: false }).limit(100).returns<Row[]>();
  if (bookingsError) {
    logError("admin bookings page: bookings query failed", bookingsError, {
      tag: "admin-bookings", route: "/admin/bookings", userId: user.id,
    });
  }
  const allBookings = data ?? [];

  const allIds = [...new Set([...allBookings.map(b => b.student_id), ...allBookings.map(b => b.teacher_id)])];
  const nameMap = await buildNameMap(supabase, allIds);

  // Filter on either student or teacher name; the table itself owns
  // status/type filtering, so the search and the existing filters compose.
  const needle = q.trim().toLowerCase();
  const bookings = needle
    ? allBookings.filter(b => {
        const sName = (nameMap[b.student_id] ?? "").toLowerCase();
        const tName = (nameMap[b.teacher_id] ?? "").toLowerCase();
        return sName.includes(needle) || tName.includes(needle);
      })
    : allBookings;

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><BookOpen size={24} className="text-gold" /> {t("إدارة الحجوزات", "Manage Bookings")}</h1>
      <div className="mb-4">
        <SearchInput placeholder={t("ابحث باسم الطالب أو المعلم...", "Search by student or teacher name...")} ariaLabel={t("بحث الحجوزات", "Search bookings")} />
      </div>
      <BookingsTable bookings={bookings} nameMap={nameMap} />
    </div>
  );
}
