import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Video, Inbox, Radio, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { SessionStatus } from "@/components/shared/session-status";

export const metadata: Metadata = { title: "الجلسات" };

interface SessionRow {
  id: string; booking_id: string; started_at: string | null; ended_at: string | null;
  expires_at: string | null; is_observable: boolean; created_at: string;
}
interface BookingRow { id: string; student_id: string; teacher_id: string; scheduled_at: string; duration_min: number; }

export default async function ModeratorSessionsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sessions } = await supabase.from("sessions")
    .select("id, booking_id, started_at, ended_at, expires_at, is_observable, created_at")
    .order("created_at", { ascending: false }).limit(50).returns<SessionRow[]>();
  const list = sessions ?? [];

  // Resolve booking + names
  let bookingMap: Record<string, BookingRow> = {};
  let nameMap: Record<string, string> = {};
  if (list.length > 0) {
    const bIds = list.map(s => s.booking_id);
    const { data: bookings } = await supabase.from("bookings")
      .select("id, student_id, teacher_id, scheduled_at, duration_min")
      .in("id", bIds).returns<BookingRow[]>();
    if (bookings) {
      bookingMap = Object.fromEntries(bookings.map(b => [b.id, b]));
      const pIds = [...new Set([...bookings.map(b => b.student_id), ...bookings.map(b => b.teacher_id)])];
      const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", pIds)
        .returns<{ id: string; full_name: string | null }[]>();
      if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
    }
  }

  const activeSessions = list.filter(s => s.started_at && !s.ended_at);

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Video size={24} className="text-gold" /> {t("الجلسات", "Sessions")}</h1>
        {activeSessions.length > 0 && (
          <span className="glass-badge glass-success flex items-center gap-2 rounded-full px-3 py-1 text-sm">
            <Radio size={14} className="animate-pulse" /> {activeSessions.length} {t("نشطة", "active")}
          </span>
        )}
      </div>

      {list.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">{t("لا توجد جلسات", "No sessions yet")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(s => {
            const b = bookingMap[s.booking_id];
            const isActive = !!s.started_at && !s.ended_at;
            return (
              <div key={s.id} className={`rounded-xl p-4 ${isActive ? "glass-card border-success/30 bg-success/5" : "glass-card"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      {b && <p className="text-sm font-medium">{nameMap[b.student_id] ?? "—"} ← {nameMap[b.teacher_id] ?? "—"}</p>}
                      {b && <SessionStatus scheduledAt={b.scheduled_at} durationMin={b.duration_min} expiresAt={s.expires_at} endedAt={s.ended_at} size="sm" />}
                    </div>
                    <p className="text-xs text-muted">{new Date(s.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isActive && s.is_observable && (
                      <Link href={`/moderator/sessions/${s.id}/observe`} className="glass glass-pill flex items-center gap-1 px-3 py-1 text-xs text-gold transition-colors hover:bg-white/10">
                        <Eye size={12} /> {t("مراقبة", "Observe")}
                      </Link>
                    )}
                    <Link href={`/moderator/sessions/${s.id}`} className="text-xs text-gold hover:text-gold-light">{t("تفاصيل ←", "Details →")}</Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
