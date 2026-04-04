import { redirect } from "next/navigation";
import {
  BookOpen,
  Clock,
  Hourglass,
  Star,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/shared/logout-button";
import { BookingActions } from "./booking-actions";
import type { BookingStatus, SessionType } from "@/types/database";

const SESSION_TYPE_AR: Record<SessionType, string> = {
  hifz: "حفظ",
  muraja: "مراجعة",
  tajweed: "تجويد",
  tilawa: "تلاوة",
  qiraat: "ق��اءات",
  tafsir: "تفسير",
  combined: "حفظ + مراجعة",
  other: "أخرى",
};

interface PendingBooking {
  id: string;
  scheduled_at: string;
  duration_min: number;
  session_type: SessionType;
  amount_usd: number;
  student_id: string;
}

export default async function TeacherDashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Parallel: profile name, teacher stats, pending bookings, all booking count
  const [profileRes, tpRes, pendingRes, allRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single<{ full_name: string | null }>(),

    supabase
      .from("teacher_profiles")
      .select("total_sessions, rating_avg")
      .eq("teacher_id", user.id)
      .single<{ total_sessions: number; rating_avg: number }>(),

    supabase
      .from("bookings")
      .select("id, scheduled_at, duration_min, session_type, amount_usd, student_id")
      .eq("teacher_id", user.id)
      .eq("status", "pending")
      .order("scheduled_at", { ascending: true })
      .returns<PendingBooking[]>(),

    supabase
      .from("bookings")
      .select("status")
      .eq("teacher_id", user.id)
      .returns<{ status: BookingStatus }[]>(),
  ]);

  const fullName = profileRes.data?.full_name;
  const totalSessions = tpRes.data?.total_sessions ?? 0;
  const ratingAvg = Number(tpRes.data?.rating_avg ?? 0);
  const pending = pendingRes.data ?? [];
  const allBookings = allRes.data ?? [];

  const pendingCount = allBookings.filter((b) => b.status === "pending").length;

  // Fetch student names for pending bookings
  let studentNames: Record<string, string> = {};
  if (pending.length > 0) {
    const ids = [...new Set(pending.map((b) => b.student_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();

    if (profiles) {
      studentNames = Object.fromEntries(
        profiles.map((p) => [p.id, p.full_name ?? "طالب"]),
      );
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      {/* Welcome + Logout */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            أهلاً{fullName ? ` ${fullName}` : ""}
            <span className="mr-2 text-gold">👋</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Teacher dashboard
          </p>
        </div>
        <LogoutButton />
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2 text-muted">
            <BookOpen size={18} />
            <span className="text-sm">جلسات مكتملة</span>
          </div>
          <p className="text-3xl font-bold text-gold">{totalSessions}</p>
          <p className="mt-1 text-xs text-muted">Completed</p>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2 text-muted">
            <Hourglass size={18} />
            <span className="text-sm">بانتظار التأكيد</span>
          </div>
          <p className="text-3xl font-bold text-gold">{pendingCount}</p>
          <p className="mt-1 text-xs text-muted">Pending</p>
        </div>

        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2 text-muted">
            <Star size={18} />
            <span className="text-sm">التقييم</span>
          </div>
          <p className="text-3xl font-bold text-gold">
            {ratingAvg > 0 ? ratingAvg.toFixed(1) : "—"}
          </p>
          <p className="mt-1 text-xs text-muted">Rating</p>
        </div>
      </div>

      {/* Pending Bookings */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">
          <Clock size={20} className="ml-2 inline text-gold" />
          حجوزات بانتظار التأكيد
        </h2>

        {pending.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <Clock size={32} className="mx-auto mb-3 text-muted" />
            <p className="text-muted">لا توجد حجوزات معلقة</p>
            <p className="mt-1 text-xs text-muted">No pending bookings</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((booking) => {
              const date = new Date(booking.scheduled_at);

              return (
                <div
                  key={booking.id}
                  className="rounded-xl border border-card-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {studentNames[booking.student_id] ?? "طالب"}
                      </p>
                      <p className="mt-1 text-sm text-gold">
                        {SESSION_TYPE_AR[booking.session_type]}
                        <span className="mr-2 text-muted">
                          · {booking.duration_min} دقيقة
                        </span>
                        <span className="mr-2 text-muted">
                          · ${booking.amount_usd}
                        </span>
                      </p>
                      <div
                        dir="ltr"
                        className="mt-2 text-left text-sm text-muted"
                      >
                        {date.toLocaleDateString("ar-SA", {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                        <span className="mx-2">·</span>
                        {date.toLocaleTimeString("ar-SA", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>

                    <BookingActions bookingId={booking.id} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
