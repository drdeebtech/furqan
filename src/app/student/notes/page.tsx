import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FileText, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";
import type { SessionType } from "@/types/database";

export const metadata: Metadata = { title: "ملاحظات المعلم" };

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

interface SessionRow { id: string; booking_id: string; post_session_notes: string; homework: string | null; created_at: string; }
interface BookingRow { id: string; teacher_id: string; scheduled_at: string; duration_min: number; session_type: SessionType; }

export default async function StudentNotesPage() {
  const { t, dir, lang } = await getT();
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
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? t("معلم", "Teacher")]));
  }

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 font-display text-2xl font-bold"><FileText size={24} className="text-gold" /> {t("ملاحظات المعلم", "Teacher Notes")}</h1>
      <p className="mb-8 text-xs text-muted">{t("تجد هنا ملاحظات معلمك بعد كل جلسة", "Find your teacher's notes after each session here")}</p>

      {sessions.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا توجد ملاحظات بعد", "No notes yet")}</p>
          <p className="mt-1 text-sm text-muted">{t("ستظهر ملاحظات معلمك هنا بعد كل جلسة مكتملة", "Your teacher's notes will appear here after each completed session")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map(s => {
            const booking = bookingMap[s.booking_id];
            if (!booking) return null;
            return (
              <div key={s.id} className="glass-card p-6">
                <div className="mb-4 flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{nameMap[booking.teacher_id] ?? t("معلم", "Teacher")}</span>
                    <span className="me-2 text-muted">
                      · {lang === "ar" ? SESSION_TYPE_AR[booking.session_type] : SESSION_TYPE_EN[booking.session_type]}
                      · {booking.duration_min} {t("د", "m")}
                    </span>
                  </div>
                  <span className="text-xs text-muted">{new Date(booking.scheduled_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
                </div>
                <div className="border-t border-white/10 pt-4">
                  <p className="mb-2 text-xs font-medium text-gold">{t("ملاحظات الجلسة", "Session Notes")}</p>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{s.post_session_notes}</p>
                </div>
                {s.homework && (
                  <div className="mt-4 glass rounded-lg p-3">
                    <p className="mb-1 text-xs font-medium text-gold">{t("الواجب", "Homework")}</p>
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
