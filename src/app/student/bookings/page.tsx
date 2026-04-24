import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "حجوزاتي" };
import Link from "next/link";
import { CalendarCheck, Plus, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR, STATUS_STYLE } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";
import type { BookingStatus, SessionType } from "@/types/database";

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

interface BookingRow {
  id: string;
  scheduled_at: string;
  duration_min: number;
  status: BookingStatus;
  session_type: SessionType;
  amount_usd: number;
  teacher_id: string;
}

export default async function StudentBookingsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, scheduled_at, duration_min, status, session_type, amount_usd, teacher_id",
    )
    .eq("student_id", user.id)
    .order("scheduled_at", { ascending: false })
    .returns<BookingRow[]>();

  const list = bookings ?? [];

  // Batch-fetch teacher names
  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const ids = [...new Set(list.map((b) => b.teacher_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();

    if (profiles) {
      nameMap = Object.fromEntries(
        profiles.map((p) => [p.id, p.full_name ?? t("معلم", "Teacher")]),
      );
    }
  }

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
          <CalendarCheck size={24} className="text-gold" />
          {t("حجوزاتي", "My Bookings")}
        </h1>
        <Link
          href="/student/teachers"
          className="flex items-center gap-1.5 glass-gold glass-pill px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          <Plus size={16} />
          {t("حجز جديد", "New Booking")}
        </Link>
      </div>

      {list.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-4 text-muted" />
          <p className="text-lg text-muted">{t("لم تقم بأي حجز حتى الآن", "You haven't made any bookings yet")}</p>
          <p className="mt-1 text-sm text-muted">{t("ابدأ بتصفح المعلمين واحجز جلستك الأولى", "Browse teachers and book your first session")}</p>
          <Link
            href="/student/teachers"
            className="mt-4 inline-flex items-center gap-1.5 glass-gold glass-pill px-5 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            {t("تصفح المعلمين", "Browse Teachers")}
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((booking) => {
            const date = new Date(booking.scheduled_at);
            const statusInfo = STATUS_STYLE[booking.status];
            const locale = lang === "ar" ? "ar-SA" : "en-US";

            return (
              <div
                key={booking.id}
                className="glass-card p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">
                      {nameMap[booking.teacher_id] ?? t("معلم", "Teacher")}
                    </p>
                    <p className="mt-1 text-sm text-gold">
                      {lang === "ar" ? SESSION_TYPE_AR[booking.session_type] : SESSION_TYPE_EN[booking.session_type]}
                      <span className="me-2 text-muted">
                        · {booking.duration_min} {t("دقيقة", "min")}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span
                      className={`glass-badge px-2.5 py-0.5 text-xs ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>
                </div>

                <div dir="ltr" className="mt-3 text-left text-sm text-muted">
                  {date.toLocaleDateString(locale, {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  <span className="mx-2">·</span>
                  {date.toLocaleTimeString(locale, {
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
