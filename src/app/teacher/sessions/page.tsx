import { redirect } from "next/navigation";
import { Video, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { BookingStatus, SessionType } from "@/types/database";

const SESSION_TYPE_AR: Record<SessionType, string> = {
  hifz: "حفظ",
  muraja: "مراجعة",
  tajweed: "تجويد",
  tilawa: "تلاوة",
  qiraat: "قراءات",
  tafsir: "تفسير",
  combined: "حفظ + مراجعة",
  other: "أخرى",
};

const STATUS_STYLE: Record<
  "confirmed" | "completed",
  { label: string; className: string }
> = {
  confirmed: {
    label: "مؤكد",
    className: "bg-green-500/10 text-green-400 border-green-500/30",
  },
  completed: {
    label: "مكتمل",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
};

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, scheduled_at, duration_min, status, session_type, amount_usd, student_id",
    )
    .eq("teacher_id", user.id)
    .in("status", ["confirmed", "completed"])
    .order("scheduled_at", { ascending: false })
    .returns<SessionBooking[]>();

  const list = bookings ?? [];

  // Batch-fetch student names
  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = [...new Set(list.map((b) => b.student_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();

    if (profiles) {
      nameMap = Object.fromEntries(
        profiles.map((p) => [p.id, p.full_name ?? "طالب"]),
      );
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">
        <Video size={24} className="ml-2 inline text-gold" />
        جلساتي
      </h1>

      {list.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-4 text-muted" />
          <p className="text-lg text-muted">لا توجد جلسات بعد</p>
          <p className="mt-1 text-sm text-muted">No sessions yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((booking) => {
            const date = new Date(booking.scheduled_at);
            const statusInfo =
              STATUS_STYLE[booking.status as "confirmed" | "completed"];

            return (
              <div
                key={booking.id}
                className="rounded-xl border border-card-border bg-card p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">
                      {nameMap[booking.student_id] ?? "طالب"}
                    </p>
                    <p className="mt-1 text-sm text-gold">
                      {SESSION_TYPE_AR[booking.session_type]}
                      <span className="mr-2 text-muted">
                        · {booking.duration_min} دقيقة
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {statusInfo && (
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs ${statusInfo.className}`}
                      >
                        {statusInfo.label}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-gold">
                      ${booking.amount_usd}
                    </span>
                  </div>
                </div>

                <div dir="ltr" className="mt-3 text-left text-sm text-muted">
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
            );
          })}
        </div>
      )}
    </div>
  );
}
