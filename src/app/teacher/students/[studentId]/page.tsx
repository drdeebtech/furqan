import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";

interface Props { params: Promise<{ studentId: string }>; }

interface BookingRow { id: string; scheduled_at: string; duration_min: number; session_type: SessionType; status: string; }
interface SessionRow { booking_id: string; post_session_notes: string | null; homework: string | null; }

export default async function StudentDetailPage({ params }: Props) {
  const { studentId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, bookingsRes] = await Promise.all([
    supabase.from("profiles").select("full_name, phone, country").eq("id", studentId).single<{ full_name: string | null; phone: string | null; country: string | null }>(),
    supabase.from("bookings")
      .select("id, scheduled_at, duration_min, session_type, status")
      .eq("student_id", studentId).eq("teacher_id", user.id)
      .in("status", ["confirmed", "completed"])
      .order("scheduled_at", { ascending: false })
      .returns<BookingRow[]>(),
  ]);

  const student = profileRes.data;
  if (!student) redirect("/teacher/students");
  const bookings = bookingsRes.data ?? [];

  // Get session notes
  let sessionMap: Record<string, SessionRow> = {};
  if (bookings.length > 0) {
    const bIds = bookings.map(b => b.id);
    const { data: sessions } = await supabase.from("sessions")
      .select("booking_id, post_session_notes, homework")
      .in("booking_id", bIds).returns<SessionRow[]>();
    if (sessions) sessionMap = Object.fromEntries(sessions.map(s => [s.booking_id, s]));
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/teacher/students" className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover">
        <ArrowRight size={14} /> العودة لطلابي
      </Link>

      <div className="mb-6 rounded-2xl border border-card-border bg-card p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-2xl font-bold text-gold">
            {(student.full_name ?? "ط").charAt(0)}
          </div>
          <div>
            <h1 className="text-xl font-bold">{student.full_name ?? "طالب"}</h1>
            <p className="text-sm text-muted">{bookings.length} جلسة{student.country ? ` · ${student.country}` : ""}</p>
          </div>
        </div>
      </div>

      <h2 className="mb-4 text-lg font-bold">سجل الجلسات</h2>
      {bookings.length === 0 ? (
        <p className="text-sm text-muted">لا توجد جلسات</p>
      ) : (
        <div className="space-y-3">
          {bookings.map(b => {
            const session = sessionMap[b.id];
            return (
              <div key={b.id} className="rounded-xl border border-card-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{SESSION_TYPE_AR[b.session_type]} · {b.duration_min} دقيقة</p>
                    <p className="text-xs text-muted">{new Date(b.scheduled_at).toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${b.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/10 text-amber-400 border border-amber-500/30"}`}>
                    {b.status === "completed" ? "مكتمل" : "مؤكد"}
                  </span>
                </div>
                {session?.post_session_notes && (
                  <div className="mt-3 rounded-lg border border-card-border bg-surface p-3">
                    <p className="mb-1 text-xs font-medium text-gold">ملاحظات</p>
                    <p className="text-sm text-muted">{session.post_session_notes}</p>
                  </div>
                )}
                {session?.homework && (
                  <div className="mt-2 rounded-lg border border-gold/20 bg-gold/5 p-3">
                    <p className="mb-1 text-xs font-medium text-gold">واجب</p>
                    <p className="text-sm text-muted">{session.homework}</p>
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
