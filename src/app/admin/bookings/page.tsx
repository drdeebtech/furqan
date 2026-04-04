import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpen, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { BookingStatus, SessionType } from "@/types/database";
import { BookingStatusSelect } from "./booking-status-select";

export const metadata: Metadata = { title: "إدارة الحجوزات" };

interface Row { id: string; student_id: string; teacher_id: string; scheduled_at: string; duration_min: number; status: BookingStatus; session_type: SessionType; amount_usd: number; created_at: string; }

export default async function AdminBookingsPage() {
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

  const pending = bookings.filter(b => b.status === "pending").length;
  const confirmed = bookings.filter(b => b.status === "confirmed").length;
  const completed = bookings.filter(b => b.status === "completed").length;

  return (
    <div dir="rtl" className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><BookOpen size={24} className="text-gold" /> إدارة الحجوزات</h1>

      <div className="mb-6 grid grid-cols-4 gap-3">
        {[{ l: "الكل", v: bookings.length }, { l: "معلق", v: pending }, { l: "مؤكد", v: confirmed }, { l: "مكتمل", v: completed }].map(s => (
          <div key={s.l} className="rounded-xl border border-card-border bg-card p-3 text-center">
            <p className="text-xl font-bold text-gold">{s.v}</p><p className="text-xs text-muted">{s.l}</p>
          </div>
        ))}
      </div>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">لا توجد حجوزات</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-card-border bg-card">
              <th className="px-3 py-3 text-right font-medium text-muted">الطالب</th>
              <th className="px-3 py-3 text-right font-medium text-muted">المعلم</th>
              <th className="px-3 py-3 text-right font-medium text-muted">النوع</th>
              <th className="px-3 py-3 text-right font-medium text-muted">الموعد</th>
              <th className="px-3 py-3 text-right font-medium text-muted">المبلغ</th>
              <th className="px-3 py-3 text-right font-medium text-muted">الحالة</th>
            </tr></thead>
            <tbody>
              {bookings.map(b => (
                <tr key={b.id} className="border-b border-card-border last:border-b-0">
                  <td className="px-3 py-3">{nameMap[b.student_id] ?? "—"}</td>
                  <td className="px-3 py-3">{nameMap[b.teacher_id] ?? "—"}</td>
                  <td className="px-3 py-3 text-xs text-gold">{SESSION_TYPE_AR[b.session_type]}</td>
                  <td className="px-3 py-3 text-xs text-muted">{new Date(b.scheduled_at).toLocaleDateString("ar-SA")} {b.duration_min}د</td>
                  <td className="px-3 py-3 text-gold">${b.amount_usd}</td>
                  <td className="px-3 py-3"><BookingStatusSelect bookingId={b.id} currentStatus={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
