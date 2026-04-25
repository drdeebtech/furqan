import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "طلابي" };

export default async function TeacherStudentsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const { data: bookingData } = await supabase.from("bookings")
    .select("student_id, scheduled_at, status")
    .eq("teacher_id", user.id).in("status", ["confirmed", "completed"])
    .order("scheduled_at", { ascending: false })
    .returns<{ student_id: string; scheduled_at: string; status: string }[]>();

  const list = bookingData ?? [];

  // Group by student
  const studentStats = new Map<string, { total: number; lastSession: string; thisMonth: number }>();
  for (const b of list) {
    const existing = studentStats.get(b.student_id);
    const isThisMonth = b.scheduled_at >= monthStart;
    if (existing) {
      existing.total++;
      if (isThisMonth) existing.thisMonth++;
    } else {
      studentStats.set(b.student_id, { total: 1, lastSession: b.scheduled_at, thisMonth: isThisMonth ? 1 : 0 });
    }
  }

  // Get profiles
  const studentIds = [...studentStats.keys()];
  let profileMap: Record<string, { full_name: string | null; phone: string | null }> = {};
  if (studentIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, phone").in("id", studentIds)
      .returns<{ id: string; full_name: string | null; phone: string | null }[]>();
    if (profiles) profileMap = Object.fromEntries(profiles.map(p => [p.id, { full_name: p.full_name, phone: p.phone }]));
  }

  const students = studentIds.map(id => ({
    id,
    name: profileMap[id]?.full_name || t("طالب", "Student"),
    phone: profileMap[id]?.phone,
    ...studentStats.get(id)!,
  }));

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold"><Users size={24} className="text-gold" /> {t("طلابي", "My Students")}</h1>
      <p className="mb-6 text-sm text-muted">{students.length} {t("طالب", "students")}</p>

      {students.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا يوجد طلاب بعد", "No students yet")}</p>
          <p className="mt-1 text-sm text-muted">{t("ستجد طلابك هنا بعد تأكيد أول حجز", "Your students will appear here after your first confirmed booking")}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {students.map(s => (
            <div key={s.id} className="glass-card p-6">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-xl font-bold text-gold">
                {s.name.charAt(0)}
              </div>
              <p className="text-lg font-bold">{s.name}</p>
              <p className="mt-1 text-sm text-muted">
                {t("آخر جلسة", "Last session")}: {new Date(s.lastSession).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}
              </p>
              <p className="text-sm text-muted">
                {s.total} {t("جلسة مكتملة", "completed")} · {s.thisMonth} {t("هذا الشهر", "this month")}
              </p>
              <div className="mt-4 flex gap-2 border-t border-white/10 pt-4">
                <Link href={`/teacher/students/${s.id}`} className="glass glass-pill flex-1 py-2 text-center text-xs text-muted transition-colors hover:border-gold/40 hover:text-gold">
                  {t("عرض التفاصيل", "View Details")}
                </Link>
                {s.phone && (
                  <a href={`https://wa.me/${s.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer" className="glass-success glass-pill px-3 py-2 text-xs text-white transition-colors hover:bg-green-700">
                    {t("واتساب", "WhatsApp")}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
