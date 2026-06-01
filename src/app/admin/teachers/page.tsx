import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { GraduationCap, Plus, Star, Inbox, FileText, Archive, CheckCircle2, Clock, XCircle, Pause } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { logError } from "@/lib/logger";
import { Avatar } from "@/components/shared/avatar";
import { SearchInput } from "@/components/shared/search-input";
import { PageHeader } from "@/components/shared/page-header";
import { ArchiveToggle } from "../dashboard/archive-toggle";

export const metadata: Metadata = { title: "إدارة المعلمين" };

interface TeacherRow { teacher_id: string; specialties: string[]; hourly_rate: number; rating_avg: number; total_sessions: number; is_accepting: boolean; is_archived: boolean; cv_status: string | null; }

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function AdminTeachersPage({ searchParams }: PageProps) {
  const { t, dir } = await getT();
  const { q = "" } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [teachersRes, cvCountRes] = await Promise.all([
    supabase.from("teacher_profiles")
      .select("teacher_id, specialties, hourly_rate, rating_avg, total_sessions, is_accepting, is_archived, cv_status")
      .order("total_sessions", { ascending: false }).returns<TeacherRow[]>(),
    supabase.from("teacher_profiles")
      .select("teacher_id", { count: "exact", head: true })
      .eq("cv_status", "pending_review"),
  ]);
  const list = teachersRes.data ?? [];
  const pendingCvCount = cvCountRes.count;

  const teacherIds = list.map(x => x.teacher_id);
  const adminCli = createAdminClient();
  const [nameMap, avatarRes] = await Promise.all([
    buildNameMap(supabase, teacherIds, t("معلم", "Teacher")),
    teacherIds.length > 0
      ? supabase.from("profiles").select("id, avatar_url").in("id", teacherIds).returns<{ id: string; avatar_url: string | null }[]>()
      : Promise.resolve({ data: [] as { id: string; avatar_url: string | null }[] }),
  ]);
  const avatarMap = Object.fromEntries((avatarRes.data ?? []).map(p => [p.id, p.avatar_url ?? null]));

  // Resolve each teacher's email by id (audit H6 — listUsers({perPage:1000})
  // only saw the 1000 most-recent auth users, so most teachers' emails were
  // missing). Resolve in bounded batches rather than one unbounded Promise.all
  // (CodeRabbit), and logError per-id failures instead of dropping silently.
  const emailMap: Record<string, string> = {};
  const EMAIL_BATCH = 10;
  for (let i = 0; i < teacherIds.length; i += EMAIL_BATCH) {
    const batch = teacherIds.slice(i, i + EMAIL_BATCH);
    const results = await Promise.all(batch.map((id) => adminCli.auth.admin.getUserById(id)));
    results.forEach((r, j) => {
      if (r.error || !r.data?.user) {
        logError("admin/teachers: getUserById failed", r.error, {
          tag: "admin-teachers", metadata: { teacherId: batch[j] },
        });
        return;
      }
      if (r.data.user.email) emailMap[batch[j]] = r.data.user.email;
    });
  }

  // Server-side filter by teacher name (resolved via nameMap) when ?q= is set.
  const needle = q.trim().toLowerCase();
  const filteredList = needle
    ? list.filter(x => (nameMap[x.teacher_id] ?? "").toLowerCase().includes(needle)
        || (emailMap[x.teacher_id] ?? "").toLowerCase().includes(needle))
    : list;

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        icon={<GraduationCap size={24} className="text-gold" />}
        title={t("إدارة المعلمين", "Manage Teachers")}
        actions={
          <>
            {(pendingCvCount ?? 0) > 0 && (
              <Link href="/admin/teachers/cv" className="flex items-center gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-medium text-warning transition-colors hover:bg-warning/20">
                <FileText size={16} />
                {t("سير ذاتية معلقة", "Pending CVs")}
                <span className="rounded-md bg-warning/90 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{pendingCvCount}</span>
              </Link>
            )}
            <Link href="/admin/teachers/new" className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium">
              <Plus size={16} /> {t("إضافة معلم", "Add Teacher")}
            </Link>
          </>
        }
      />
      {list.length > 0 && (
        <div className="mb-4">
          <SearchInput placeholder={t("ابحث بالاسم أو البريد...", "Search by name or email...")} ariaLabel={t("بحث المعلمين", "Search teachers")} />
        </div>
      )}
      {list.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">{t("لا يوجد معلمون", "No teachers yet")}</p>
        </div>
      ) : filteredList.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Inbox size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">{t("لا نتائج لبحثك", "No matches for your search")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead><tr className="glass-thead">
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("المعلم", "Teacher")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("السعر", "Rate")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("التقييم", "Rating")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الجلسات", "Sessions")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الحالة", "Status")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("السيرة الذاتية", "CV")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("إجراءات", "Actions")}</th>
            </tr></thead>
            <tbody>
              {filteredList.map(x => (
                <tr key={x.teacher_id} className={`border-b border-white/10 last:border-b-0 ${x.is_archived ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-2">
                      <Avatar src={avatarMap[x.teacher_id] ?? null} name={nameMap[x.teacher_id] ?? null} size={32} />
                      <span className="flex flex-col leading-tight">
                        <span>{nameMap[x.teacher_id] ?? t("معلم", "Teacher")}</span>
                        {emailMap[x.teacher_id] ? (
                          <a
                            href={`mailto:${emailMap[x.teacher_id]}`}
                            className="select-all text-[11px] font-normal text-muted hover:text-gold"
                            dir="ltr"
                          >
                            {emailMap[x.teacher_id]}
                          </a>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gold">${x.hourly_rate}</td>
                  <td className="px-4 py-3"><span className="flex items-center gap-1"><Star size={12} className="fill-gold text-gold" />{Number(x.rating_avg).toFixed(1)}</span></td>
                  <td className="px-4 py-3 text-muted">{x.total_sessions}</td>
                  <td className="px-4 py-3">
                    {x.is_archived ? <span className="glass-badge inline-flex items-center gap-1 border-error/30 bg-error/10 text-red-400"><Archive size={11} aria-hidden="true" />{t("مؤرشف", "Archived")}</span>
                      : x.is_accepting ? <span className="glass-badge inline-flex items-center gap-1 border-success/30 bg-success/10 text-success"><CheckCircle2 size={11} aria-hidden="true" />{t("يقبل طلاب", "Accepting")}</span>
                      : <span className="glass-badge inline-flex items-center gap-1 border-warning/30 bg-warning/10 text-warning"><Pause size={11} aria-hidden="true" />{t("مشغول", "Busy")}</span>}
                  </td>
                  <td className="px-4 py-3">
                    {x.cv_status === "approved" ? (
                      <span className="glass-badge inline-flex items-center gap-1 border-success/30 bg-success/10 text-success"><CheckCircle2 size={11} aria-hidden="true" />{t("معتمد", "Approved")}</span>
                    ) : x.cv_status === "pending_review" ? (
                      <span className="glass-badge inline-flex items-center gap-1 border-warning/30 bg-warning/10 text-warning"><Clock size={11} aria-hidden="true" />{t("قيد المراجعة", "Pending")}</span>
                    ) : x.cv_status === "rejected" ? (
                      <span className="glass-badge inline-flex items-center gap-1 border-error/30 bg-error/10 text-red-400"><XCircle size={11} aria-hidden="true" />{t("مرفوض", "Rejected")}</span>
                    ) : (
                      <span className="glass-badge inline-flex items-center gap-1 border-white/20 bg-white/5 text-muted"><FileText size={11} aria-hidden="true" />{t("مسودة", "Draft")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link href={`/admin/teachers/${x.teacher_id}`} className="text-xs text-gold hover:text-gold-light">{t("تفاصيل", "Details")}</Link>
                      <Link href={`/admin/teachers/cv/${x.teacher_id}`} className="text-xs text-gold hover:text-gold-light">{t("السيرة", "CV")}</Link>
                      <ArchiveToggle teacherId={x.teacher_id} isArchived={x.is_archived} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
