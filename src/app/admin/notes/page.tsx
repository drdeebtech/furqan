import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";

export const metadata: Metadata = { title: "ملاحظات الجلسات" };

interface SessionNote {
  id: string;
  booking_id: string;
  post_session_notes: string | null;
  homework: string | null;
  started_at: string | null;
  ended_at: string | null;
  actual_duration: number | null;
}

interface Booking {
  id: string;
  student_id: string;
  teacher_id: string;
  session_type: SessionType;
  scheduled_at: string;
  duration_min: number;
}

export default async function AdminNotesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch sessions with notes or homework
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, booking_id, post_session_notes, homework, started_at, ended_at, actual_duration")
    .or("post_session_notes.neq.,homework.neq.")
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<SessionNote[]>();

  const allSessions = sessions ?? [];

  // Fetch booking details
  const bookingIds = [...new Set(allSessions.map(s => s.booking_id))];
  let bookingMap: Record<string, Booking> = {};
  if (bookingIds.length > 0) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, student_id, teacher_id, session_type, scheduled_at, duration_min")
      .in("id", bookingIds)
      .returns<Booking[]>();
    if (bookings) bookingMap = Object.fromEntries(bookings.map(b => [b.id, b]));
  }

  // Fetch user names
  const allUserIds = [...new Set([
    ...Object.values(bookingMap).map(b => b.student_id),
    ...Object.values(bookingMap).map(b => b.teacher_id),
  ])];
  let nameMap: Record<string, string> = {};
  if (allUserIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", allUserIds)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  const notesCount = allSessions.filter(s => s.post_session_notes).length;
  const homeworkCount = allSessions.filter(s => s.homework).length;

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">ملاحظات الجلسات</h1>
      <p className="mt-1 text-sm text-muted">جميع ملاحظات المعلمين والواجبات المنزلية</p>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-card-border bg-card p-4">
          <FileText size={16} className="mb-1 text-gold" />
          <p className="text-2xl font-bold text-gold">{allSessions.length}</p>
          <p className="text-xs text-muted">إجمالي الجلسات بملاحظات</p>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4">
          <FileText size={16} className="mb-1 text-gold" />
          <p className="text-2xl font-bold text-gold">{notesCount}</p>
          <p className="text-xs text-muted">ملاحظات المعلمين</p>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-4">
          <BookOpen size={16} className="mb-1 text-gold" />
          <p className="text-2xl font-bold text-gold">{homeworkCount}</p>
          <p className="text-xs text-muted">واجبات منزلية</p>
        </div>
      </div>

      {/* Notes list */}
      <div className="mt-8 space-y-4">
        {allSessions.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <FileText size={24} className="mx-auto mb-2 text-muted" />
            <p className="text-sm text-muted">لا توجد ملاحظات بعد</p>
          </div>
        ) : (
          allSessions.map(s => {
            const b = bookingMap[s.booking_id];
            if (!b) return null;
            return (
              <div key={s.id} className="rounded-xl border border-card-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      <span className="text-gold">المعلم:</span> {nameMap[b.teacher_id] ?? "—"}
                      <span className="mx-3 text-card-border">|</span>
                      <span className="text-gold">الطالب:</span>{" "}
                      <Link href={`/admin/users/${b.student_id}`} className="text-foreground hover:text-gold">
                        {nameMap[b.student_id] ?? "—"}
                      </Link>
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {SESSION_TYPE_AR[b.session_type]} · {b.duration_min} دقيقة
                      {s.actual_duration ? ` · المدة الفعلية: ${s.actual_duration} د` : ""}
                    </p>
                  </div>
                  <p dir="ltr" className="text-left text-xs text-muted">
                    {new Date(b.scheduled_at).toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" })}
                  </p>
                </div>

                {s.post_session_notes && (
                  <div className="mt-3 rounded-lg border border-gold/20 bg-gold/5 p-3">
                    <p className="mb-1 text-xs font-medium text-gold">ملاحظات المعلم:</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{s.post_session_notes}</p>
                  </div>
                )}

                {s.homework && (
                  <div className="mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                    <p className="mb-1 text-xs font-medium text-blue-400">الواجب المنزلي:</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{s.homework}</p>
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <Link href={`/admin/sessions/${s.id}`} className="text-xs text-gold hover:text-gold-hover">
                    تفاصيل الجلسة ←
                  </Link>
                  <Link href={`/admin/users/${b.student_id}`} className="text-xs text-muted hover:text-gold">
                    ملف الطالب ←
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
