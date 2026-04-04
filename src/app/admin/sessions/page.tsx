import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Video, Inbox, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "إدارة الجلسات" };

interface SessionRow { id: string; booking_id: string; room_url: string; started_at: string | null; ended_at: string | null; actual_duration: number | null; teacher_joined: boolean; student_joined: boolean; created_at: string; }
interface BookingInfo { id: string; student_id: string; teacher_id: string; scheduled_at: string; }

export default async function AdminSessionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sessions } = await supabase.from("sessions")
    .select("id, booking_id, room_url, started_at, ended_at, actual_duration, teacher_joined, student_joined, created_at")
    .order("created_at", { ascending: false }).limit(100).returns<SessionRow[]>();
  const list = sessions ?? [];

  let bookingMap: Record<string, BookingInfo> = {};
  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const bIds = list.map(s => s.booking_id);
    const { data: bookings } = await supabase.from("bookings").select("id, student_id, teacher_id, scheduled_at").in("id", bIds).returns<BookingInfo[]>();
    if (bookings) {
      bookingMap = Object.fromEntries(bookings.map(b => [b.id, b]));
      const pIds = [...new Set([...bookings.map(b => b.student_id), ...bookings.map(b => b.teacher_id)])];
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", pIds).returns<{ id: string; full_name: string | null }[]>();
      if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Video size={24} className="text-gold" /> إدارة الجلسات</h1>
      {list.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">لا توجد جلسات</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-card-border bg-card">
              <th className="px-3 py-3 text-right font-medium text-muted">الطالب</th>
              <th className="px-3 py-3 text-right font-medium text-muted">المعلم</th>
              <th className="px-3 py-3 text-right font-medium text-muted">الموعد</th>
              <th className="px-3 py-3 text-right font-medium text-muted">المدة</th>
              <th className="px-3 py-3 text-right font-medium text-muted">الحضور</th>
              <th className="px-3 py-3 text-right font-medium text-muted">رابط</th>
            </tr></thead>
            <tbody>
              {list.map(s => {
                const b = bookingMap[s.booking_id];
                return (
                  <tr key={s.id} className="border-b border-card-border last:border-b-0">
                    <td className="px-3 py-3">{b ? nameMap[b.student_id] ?? "—" : "—"}</td>
                    <td className="px-3 py-3">{b ? nameMap[b.teacher_id] ?? "—" : "—"}</td>
                    <td className="px-3 py-3 text-xs text-muted">{b ? new Date(b.scheduled_at).toLocaleDateString("ar-SA") : "—"}</td>
                    <td className="px-3 py-3 text-xs">{s.actual_duration ? `${s.actual_duration} د` : s.ended_at ? "—" : <span className="text-emerald-400">جارية</span>}</td>
                    <td className="px-3 py-3 text-xs">
                      <span className={s.teacher_joined ? "text-emerald-400" : "text-red-400"}>م{s.teacher_joined ? "✓" : "✗"}</span>
                      {" "}
                      <span className={s.student_joined ? "text-emerald-400" : "text-red-400"}>ط{s.student_joined ? "✓" : "✗"}</span>
                    </td>
                    <td className="px-3 py-3"><a href={s.room_url} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-gold-light"><ExternalLink size={14} /></a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
