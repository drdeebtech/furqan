import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Users, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType, BookingStatus } from "@/types/database";

export const metadata: Metadata = { title: "طلابي" };

interface BookingRow {
  student_id: string;
  session_type: SessionType;
  status: BookingStatus;
  scheduled_at: string;
}

export default async function TeacherStudentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: bookings } = await supabase
    .from("bookings")
    .select("student_id, session_type, status, scheduled_at")
    .eq("teacher_id", user.id)
    .in("status", ["confirmed", "completed"])
    .order("scheduled_at", { ascending: false })
    .returns<BookingRow[]>();

  const list = bookings ?? [];

  // Group by student
  const studentMap = new Map<string, { sessions: number; lastSession: string; types: Set<string> }>();
  for (const b of list) {
    const existing = studentMap.get(b.student_id);
    if (existing) {
      existing.sessions++;
      existing.types.add(b.session_type);
    } else {
      studentMap.set(b.student_id, {
        sessions: 1,
        lastSession: b.scheduled_at,
        types: new Set([b.session_type]),
      });
    }
  }

  // Fetch student names
  let nameMap: Record<string, string> = {};
  if (studentMap.size > 0) {
    const ids = [...studentMap.keys()];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(profiles.map((p) => [p.id, p.full_name ?? "طالب"]));
    }
  }

  const students = [...studentMap.entries()].map(([id, data]) => ({
    id,
    name: nameMap[id] ?? "طالب",
    sessions: data.sessions,
    lastSession: data.lastSession,
    types: [...data.types],
  }));

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold">
        <Users size={24} className="text-gold" />
        طلابي
      </h1>

      {students.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا يوجد طلاب بعد</p>
          <p className="mt-1 text-sm text-muted">سيظهر هنا الطلاب الذين حجزوا جلسات معك</p>
        </div>
      ) : (
        <div className="space-y-3">
          {students.map((s) => (
            <div key={s.id} className="rounded-xl border border-card-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="mt-1 text-sm text-muted">
                    {s.sessions} {s.sessions === 1 ? "جلسة" : "جلسات"}
                    <span className="mx-2">·</span>
                    آخر جلسة: {new Date(s.lastSession).toLocaleDateString("ar-SA")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {s.types.map((t) => (
                    <span key={t} className="rounded-full border border-card-border px-2 py-0.5 text-xs text-muted">
                      {SESSION_TYPE_AR[t as SessionType] ?? t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
