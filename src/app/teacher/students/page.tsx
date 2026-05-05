import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Inbox, AlertCircle, ClipboardCheck, Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { SearchInput } from "@/components/shared/search-input";

export const metadata: Metadata = { title: "طلابي" };

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function TeacherStudentsPage({ searchParams }: PageProps) {
  const { t, dir, lang } = await getT();
  const { q = "" } = await searchParams;
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

  // Pedagogical-state queries — turn the student list from a flat
  // directory into a triage board. Three extra parallel reads:
  //   - latest session_evaluations.created_at per student (overdue
  //     evaluation flag at >30 days)
  //   - homework_assignments where status='student_ready' grouped by
  //     student (ungraded count)
  //   - upcoming confirmed bookings per student (next-session date)
  const nowIso = new Date().toISOString();
  const [evalRowsRes, ungradedRowsRes, upcomingRowsRes] = await Promise.all([
    studentIds.length > 0
      ? supabase
          .from("session_evaluations")
          .select("student_id, created_at")
          .eq("teacher_id", user.id)
          .in("student_id", studentIds)
          .order("created_at", { ascending: false })
          .returns<{ student_id: string; created_at: string }[]>()
      : Promise.resolve({ data: [] }),
    studentIds.length > 0
      ? supabase
          .from("homework_assignments")
          .select("student_id")
          .eq("teacher_id", user.id)
          .eq("status", "student_ready")
          .in("student_id", studentIds)
          .returns<{ student_id: string }[]>()
      : Promise.resolve({ data: [] }),
    studentIds.length > 0
      ? supabase
          .from("bookings")
          .select("student_id, scheduled_at")
          .eq("teacher_id", user.id)
          .eq("status", "confirmed")
          .gte("scheduled_at", nowIso)
          .in("student_id", studentIds)
          .order("scheduled_at", { ascending: true })
          .returns<{ student_id: string; scheduled_at: string }[]>()
      : Promise.resolve({ data: [] }),
  ]);

  // Reduce: latest eval date, ungraded count, next session date — all
  // keyed by student_id for O(1) lookup in the render loop.
  const lastEvalAt: Record<string, string> = {};
  for (const e of evalRowsRes.data ?? []) {
    if (!lastEvalAt[e.student_id]) lastEvalAt[e.student_id] = e.created_at;
  }
  const ungradedCount: Record<string, number> = {};
  for (const h of ungradedRowsRes.data ?? []) {
    ungradedCount[h.student_id] = (ungradedCount[h.student_id] ?? 0) + 1;
  }
  const nextSessionAt: Record<string, string> = {};
  for (const b of upcomingRowsRes.data ?? []) {
    if (!nextSessionAt[b.student_id]) nextSessionAt[b.student_id] = b.scheduled_at;
  }

  const allStudents = studentIds.map(id => ({
    id,
    name: profileMap[id]?.full_name || t("طالب", "Student"),
    phone: profileMap[id]?.phone,
    lastEvalAt: lastEvalAt[id] ?? null,
    ungraded: ungradedCount[id] ?? 0,
    nextSessionAt: nextSessionAt[id] ?? null,
    ...studentStats.get(id)!,
  }));

  const needle = q.trim().toLowerCase();
  const students = needle
    ? allStudents.filter(s => s.name.toLowerCase().includes(needle))
    : allStudents;

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold"><Users size={24} className="text-gold" /> {t("طلابي", "My Students")}</h1>
      <p className="mb-4 text-sm text-muted">{allStudents.length} {t("طالب", "students")}</p>

      {allStudents.length > 0 && (
        <div className="mb-6">
          <SearchInput placeholder={t("ابحث باسم الطالب...", "Search by student name...")} ariaLabel={t("بحث الطلاب", "Search students")} />
        </div>
      )}

      {allStudents.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">{t("لا يوجد طلاب بعد", "No students yet")}</p>
          <p className="mt-1 text-sm text-muted">{t("ستجد طلابك هنا بعد تأكيد أول حجز", "Your students will appear here after your first confirmed booking")}</p>
        </div>
      ) : students.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">{t("لا نتائج لبحثك", "No matches for your search")}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {students.map(s => {
            const daysSinceEval = s.lastEvalAt
              ? Math.floor((Date.now() - new Date(s.lastEvalAt).getTime()) / 86400_000)
              : null;
            const evalOverdue = daysSinceEval == null || daysSinceEval > 30;
            const localeArg = lang === "ar" ? "ar" : "en-US";
            return (
              <div key={s.id} className="glass-card p-6">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-xl font-bold text-gold">
                  {s.name.charAt(0)}
                </div>
                <p className="text-lg font-bold">{s.name}</p>
                <p className="mt-1 text-sm text-muted">
                  {t("آخر جلسة", "Last session")}: {new Date(s.lastSession).toLocaleDateString(localeArg)}
                </p>
                <p className="text-sm text-muted">
                  {s.total} {t("جلسة مكتملة", "completed")} · {s.thisMonth} {t("هذا الشهر", "this month")}
                </p>

                {/* Status row — pedagogical signals: ungraded homework
                    count, days since last evaluation, next session date.
                    Each chip is clickable when it has a useful target. */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                  {s.ungraded > 0 && (
                    <Link
                      href="/teacher/follow-up"
                      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 font-medium text-warning hover:bg-warning/15 focus-ring"
                      title={t(`${s.ungraded} متابعات بانتظار التقييم`, `${s.ungraded} follow-ups awaiting grading`)}
                    >
                      <ClipboardCheck size={11} aria-hidden="true" />
                      {s.ungraded} {t("بانتظار التقييم", "to grade")}
                    </Link>
                  )}
                  {s.nextSessionAt && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-blue-300"
                      title={new Date(s.nextSessionAt).toLocaleString(localeArg, { dateStyle: "medium", timeStyle: "short" })}
                    >
                      <Calendar size={11} aria-hidden="true" />
                      {t("قادم", "Next")}: {new Date(s.nextSessionAt).toLocaleDateString(localeArg, { month: "short", day: "numeric" })}
                    </span>
                  )}
                  {evalOverdue && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-orange-300"
                      title={daysSinceEval != null
                        ? t(`آخر تقييم قبل ${daysSinceEval} يوماً`, `Last evaluation ${daysSinceEval} days ago`)
                        : t("لم يُقيَّم بعد", "Never evaluated")}
                    >
                      <AlertCircle size={11} aria-hidden="true" />
                      {daysSinceEval == null
                        ? t("بحاجة تقييم", "Needs eval")
                        : t(`تقييم منذ ${daysSinceEval} يوم`, `Eval ${daysSinceEval}d ago`)}
                    </span>
                  )}
                </div>

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
            );
          })}
        </div>
      )}
    </div>
  );
}
