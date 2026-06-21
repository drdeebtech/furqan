import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Inbox, AlertCircle, ClipboardCheck, Calendar, Briefcase } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { SearchInput } from "@/components/shared/search-input";

export const metadata: Metadata = { title: "طلابي" };

type SortKey = "name" | "balance" | "eval";

interface PageProps {
  searchParams: Promise<{ q?: string; sort?: string }>;
}

export default async function TeacherStudentsPage({ searchParams }: PageProps) {
  const { t, dir, lang } = await getT();
  const params = await searchParams;
  const q = params.q ?? "";
  const sort: SortKey =
    params.sort === "balance" || params.sort === "eval"
      ? params.sort
      : "name";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Per-student booking aggregates (total / this-month / last session) computed
  // server-side via RPC — avoids the previous 500-row cap that silently
  // truncated stats for high-volume teachers. The function keys on auth.uid(),
  // so a teacher only ever receives their own students.
  const { data: statRows } = await (
    supabase.rpc as unknown as (
      fn: string,
    ) => Promise<{
      data:
        | { student_id: string; total: number; this_month: number; last_session: string }[]
        | null;
    }>
  )("teacher_student_booking_stats");

  const studentStats = new Map<string, { total: number; lastSession: string; thisMonth: number }>();
  for (const r of statRows ?? []) {
    studentStats.set(r.student_id, {
      total: Number(r.total),
      lastSession: r.last_session,
      thisMonth: Number(r.this_month),
    });
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
  const [evalRowsRes, ungradedRowsRes, upcomingRowsRes, pkgRowsRes] = await Promise.all([
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
    // Active package balances per student. Gated by the new SELECT policy
    // `student_packages_teacher_read` (migration 20260506140536) which
    // checks `private.teacher_has_booked_student(auth.uid(), student_id)`.
    // Without that policy this returns 0 rows.
    studentIds.length > 0
      ? supabase
          .from("student_packages")
          .select("student_id, sessions_remaining")
          .eq("status", "active")
          .in("student_id", studentIds)
          .returns<{ student_id: string; sessions_remaining: number | null }[]>()
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
  // Sum sessions_remaining across active packages per student, AND track
  // whether the student has an active package row at all. The two states
  // are visually different (caught in the 2026-05-06 visual audit):
  //   - hasActivePackage=false → "No package" in neutral grey
  //   - hasActivePackage=true,  remaining=0  → red "0 left" (consumed)
  //   - hasActivePackage=true,  remaining≤2  → amber
  //   - hasActivePackage=true,  remaining>2  → emerald
  const sessionsRemaining: Record<string, number> = {};
  const hasActivePackage: Record<string, boolean> = {};
  if (pkgRowsRes.data) {
    for (const p of pkgRowsRes.data) {
      sessionsRemaining[p.student_id] =
        (sessionsRemaining[p.student_id] ?? 0) + (p.sessions_remaining ?? 0);
      hasActivePackage[p.student_id] = true;
    }
  }

  const allStudents = studentIds.map(id => ({
    id,
    name: profileMap[id]?.full_name || t("طالب", "Student"),
    phone: profileMap[id]?.phone,
    lastEvalAt: lastEvalAt[id] ?? null,
    ungraded: ungradedCount[id] ?? 0,
    nextSessionAt: nextSessionAt[id] ?? null,
    sessionsRemaining: sessionsRemaining[id] ?? 0,
    hasActivePackage: hasActivePackage[id] ?? false,
    ...studentStats.get(id)!,
  }));

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? allStudents.filter(s => s.name.toLowerCase().includes(needle))
    : allStudents;

  // Sort logic — three modes:
  //  - "name" (default): A→Z by display name
  //  - "balance": ascending sessions remaining (lowest = needs attention first;
  //               students without an active package go to the bottom)
  //  - "eval": ascending days since last eval (oldest = needs attention first;
  //            never-evaluated students go to the top)
  const students = [...filtered].sort((a, b) => {
    if (sort === "balance") {
      // Bucket: has package + 0 left first, has package + low next, etc.
      // No package goes last (no urgency to act).
      const aBucket = !a.hasActivePackage ? 9999 : a.sessionsRemaining;
      const bBucket = !b.hasActivePackage ? 9999 : b.sessionsRemaining;
      if (aBucket !== bBucket) return aBucket - bBucket;
      return a.name.localeCompare(b.name);
    }
    if (sort === "eval") {
      const aDays = a.lastEvalAt
        ? Math.floor((Date.now() - new Date(a.lastEvalAt).getTime()) / 86400_000)
        : Number.POSITIVE_INFINITY; // never evaluated → top
      const bDays = b.lastEvalAt
        ? Math.floor((Date.now() - new Date(b.lastEvalAt).getTime()) / 86400_000)
        : Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return bDays - aDays;
      return a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });

  // Build sort-link href that preserves the search query so a teacher can
  // filter by name AND change sort without losing context.
  const sortLink = (key: SortKey) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (key !== "name") sp.set("sort", key);
    const qs = sp.toString();
    return qs ? `/teacher/students?${qs}` : "/teacher/students";
  };

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold"><Users size={24} className="text-gold" /> {t("طلابي", "My Students")}</h1>
      <p className="mb-4 text-sm text-muted">{allStudents.length} {t("طالب", "students")}</p>

      {allStudents.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1">
            <SearchInput placeholder={t("ابحث باسم الطالب...", "Search by student name...")} ariaLabel={t("بحث الطلاب", "Search students")} />
          </div>
          <div role="group" aria-label={t("الترتيب", "Sort")} className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-light">{t("الترتيب:", "Sort:")}</span>
            {([
              { key: "name" as SortKey, ar: "الاسم", en: "Name" },
              { key: "balance" as SortKey, ar: "الرصيد", en: "Balance" },
              { key: "eval" as SortKey, ar: "آخر تقييم", en: "Last eval" },
            ]).map((opt) => {
              const active = sort === opt.key;
              return (
                <Link
                  key={opt.key}
                  href={sortLink(opt.key)}
                  className={`rounded-full border px-3 py-1 transition-colors focus-ring ${
                    active
                      ? "border-gold/50 bg-gold/15 text-gold"
                      : "border-card-border bg-card/30 text-muted hover:bg-card/50"
                  }`}
                >
                  {t(opt.ar, opt.en)}
                </Link>
              );
            })}
          </div>
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
            const localeArg = lang === "ar" ? "ar-EG" : "en-US";
            return (
              <div key={s.id} className="glass-card p-6">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-display text-xl font-bold text-gold">
                  {(s.name.trim().charAt(0) || "—").toUpperCase()}
                </div>
                <p className="text-lg font-bold">{s.name}</p>
                <p className="mt-1 text-sm text-muted">
                  {t("آخر جلسة", "Last session")}: {new Date(s.lastSession).toLocaleDateString(localeArg, { year: "numeric", month: "short", day: "numeric" })}
                </p>
                <p className="text-sm text-muted">
                  {s.total} {t("جلسة مكتملة", "completed")} · {s.thisMonth} {t("هذا الشهر", "this month")}
                </p>

                {/* Status row — pedagogical signals: ungraded follow-up
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
                  {/* Sessions-remaining chip — three visual states: no
                      active package (neutral grey), package consumed
                      (red), running low (amber), healthy (emerald).
                      Distinguishing "never bought a package" from
                      "consumed all sessions" was a finding in the
                      2026-05-06 visual audit. */}
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                      !s.hasActivePackage
                        ? "border-card-border/60 bg-card/30 text-muted"
                        : s.sessionsRemaining === 0
                          ? "border-error/30 bg-error/10 text-red-300"
                          : s.sessionsRemaining <= 2
                            ? "border-warning/30 bg-warning/10 text-warning"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    }`}
                    title={
                      !s.hasActivePackage
                        ? t("لا توجد باقة فعّالة لهذا الطالب", "No active package for this student")
                        : t(
                            `${s.sessionsRemaining} جلسة متبقية في الباقات الفعّالة`,
                            `${s.sessionsRemaining} session${s.sessionsRemaining === 1 ? "" : "s"} remaining across active packages`,
                          )
                    }
                  >
                    <Briefcase size={11} aria-hidden="true" />
                    {!s.hasActivePackage
                      ? t("بلا باقة", "No package")
                      : <>{s.sessionsRemaining}{" "}{t("متبقية", "left")}</>}
                  </span>
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
