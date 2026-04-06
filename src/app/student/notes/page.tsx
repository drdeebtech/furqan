import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";

export const metadata: Metadata = { title: "ملاحظات المعلم" };

interface SessionRow { id: string; booking_id: string; post_session_notes: string; homework: string | null; created_at: string; }
interface BookingRow { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: SessionType; }

export default async function StudentNotesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Get bookings for this student that are completed
  const { data: bookings } = await supabase.from("bookings")
    .select("id, teacher_id, scheduled_at, duration_min, session_type")
    .eq("student_id", user.id).eq("status", "completed")
    .order("scheduled_at", { ascending: false })
    .returns<BookingRow[]>();

  const bookingIds = (bookings ?? []).map(b => b.id);
  let sessions: SessionRow[] = [];
  if (bookingIds.length > 0) {
    const { data } = await supabase.from("sessions")
      .select("id, booking_id, post_session_notes, homework, created_at")
      .in("booking_id", bookingIds)
      .not("post_session_notes", "is", null)
      .returns<SessionRow[]>();
    sessions = (data ?? []).filter(s => s.post_session_notes && s.post_session_notes.trim() !== "");
  }

  const bookingMap = Object.fromEntries((bookings ?? []).map(b => [b.id, b]));

  // Get teacher names
  const teacherIds = [...new Set((bookings ?? []).map(b => b.teacher_id))];
  let nameMap: Record<string, string> = {};
  if (teacherIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", teacherIds).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "معلم"]));
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 font-display text-2xl font-bold"><FileText size={24} className="text-gold" /> ملاحظات المعلم</h1>
      <p className="mb-8 text-xs text-muted">تجد هنا ملاحظات معلمك بعد كل جلسة</p>

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-card elevation-2 p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد ملاحظات بعد</p>
          <p className="mt-1 text-sm text-muted">ستظهر ملاحظات معلمك هنا بعد كل جلسة مكتملة</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map(s => {
            const booking = bookingMap[s.booking_id];
            if (!booking) return null;
            return (
              <div key={s.id} className="rounded-2xl border border-card-border bg-card p-6">
                <div className="mb-4 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{nameMap[booking.teacher_id] ?? "معلم"}</span>
                    <span className="mr-2 text-muted">· {SESSION_TYPE_AR[booking.session_type]} · {booking.duration_min} د</span>
                  </div>
                  <span className="text-xs text-muted">{new Date(booking.scheduled_at).toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" })}</span>
                </div>
                <div className="border-t border-card-border pt-4">
                  <p className="mb-2 text-xs font-medium text-gold">ملاحظات الجلسة</p>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{s.post_session_notes}</p>
                </div>
                {s.homework && (
                  <div className="mt-4 rounded-lg border border-gold/20 bg-gold/5 p-3">
                    <p className="mb-1 text-xs font-medium text-gold">الواجب</p>
                    <p className="text-sm text-muted">{s.homework}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
