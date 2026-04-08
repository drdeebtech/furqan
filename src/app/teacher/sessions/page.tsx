import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Video, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR, STATUS_STYLE } from "@/lib/constants";
import type { BookingStatus, SessionType } from "@/types/database";

export const metadata: Metadata = { title: "جلساتي" };

interface SessionBooking {
  id: string;
  scheduled_at: string;
  duration_min: number;
  status: BookingStatus;
  session_type: SessionType;
  amount_usd: number;
  student_id: string;
}

export default async function TeacherSessionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, scheduled_at, duration_min, status, session_type, amount_usd, student_id")
    .eq("teacher_id", user.id)
    .in("status", ["confirmed", "completed"])
    .order("scheduled_at", { ascending: false })
    .returns<SessionBooking[]>();

  const list = bookings ?? [];

  // Fetch sessions for join links
  let sessionIdMap: Record<string, string> = {};
  if (list.length > 0) {
    const bookingIds = list.map((b) => b.id);
    const { data: sessions } = await supabase
      .from("sessions").select("id, booking_id").in("booking_id", bookingIds)
      .returns<{ id: string; booking_id: string }[]>();
    if (sessions) {
      sessionIdMap = Object.fromEntries(sessions.map((s) => [s.booking_id, s.id]));
    }
  }

  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = [...new Set(list.map((b) => b.student_id))];
    const { data: profiles } = await supabase
      .from("profiles").select("id, full_name").in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name || "طالب"]));
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <Video size={24} className="text-gold" />
        جلساتي
      </h1>

      {list.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا توجد جلسات مؤكدة</p>
          <p className="mt-1 text-sm text-muted">ستظهر هنا بعد تأكيد الحجوزات</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((booking) => {
            const date = new Date(booking.scheduled_at);
            const statusInfo = STATUS_STYLE[booking.status as "confirmed" | "completed"];
            const sessionId = sessionIdMap[booking.id];
            const isConfirmed = booking.status === "confirmed";

            return (
              <div key={booking.id} className="glass-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{nameMap[booking.student_id] ?? "طالب"}</p>
                    <p className="mt-1 text-sm text-gold">
                      {SESSION_TYPE_AR[booking.session_type]}
                      <span className="mr-2 text-muted">· {booking.duration_min} دقيقة</span>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {statusInfo && (
                      <span className={`glass-badge rounded-full px-2.5 py-0.5 text-xs ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                    )}
                    {sessionId && (
                      <Link
                        href={`/teacher/sessions/${sessionId}`}
                        className="glass-gold glass-pill flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-primary-hover focus-ring"
                      >
                        <Video size={14} />
                        {isConfirmed ? "انضم للجلسة" : "تفاصيل"}
                      </Link>
                    )}
                  </div>
                </div>
                <p dir="ltr" className="mt-3 text-left text-sm text-muted">
                  {date.toLocaleDateString("ar-SA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                  <span className="mx-2">·</span>
                  {date.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
