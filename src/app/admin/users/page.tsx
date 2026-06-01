import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Inbox, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { SearchInput } from "@/components/shared/search-input";
import { UserRow } from "./user-row";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "المستخدمون" };

interface ProfileRow { id: string; role: string; roles: string[] | null; full_name: string | null; country: string | null; is_active: boolean; deleted_at: string | null; created_at: string; }

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const { t, dir } = await getT();
  const { q = "", page: pageParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Stats via head:true count queries — never load 50k rows just to count
  // by role (audit H8). Roles are student/teacher/admin (ADR-0003); `all` is
  // the unfiltered total to capture any null/legacy role too.
  const countWhere = async (role?: "student" | "teacher" | "admin") => {
    let qy = supabase.from("profiles").select("*", { count: "exact", head: true });
    if (role) qy = qy.eq("role", role);
    return (await qy).count ?? 0;
  };
  const [allCount, students, teachers, admins] = await Promise.all([
    countWhere(), countWhere("student"), countWhere("teacher"), countWhere("admin"),
  ]);

  // Listing: paginated (audit H8 — was an unbounded full-table load). ?q filters
  // by name; ?page selects the window.
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  let listQuery = supabase.from("profiles")
    .select("id, role, roles, full_name, country, is_active, deleted_at, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (q) {
    // Escape LIKE wildcards (CodeRabbit) so a term like "50%" or "a_b" matches
    // literally instead of as a pattern. Backslash first.
    const escaped = q.replace(/\\/g, "\\\\").replace(/[%_]/g, (c) => `\\${c}`);
    listQuery = listQuery.ilike("full_name", `%${escaped}%`);
  }
  const { data, count: filteredCount } = await listQuery.returns<ProfileRow[]>();
  const users = data ?? [];
  const totalPages = Math.max(1, Math.ceil((filteredCount ?? 0) / PAGE_SIZE));

  const studentIds = users.filter(u => u.role === "student").map(u => u.id);
  const { data: signals } = studentIds.length > 0
    ? await supabase.from("retention_signals")
        .select("student_id, churn_risk_score")
        .in("student_id", studentIds)
        .returns<{ student_id: string; churn_risk_score: number | null }[]>()
    : { data: [] };
  const riskByStudent = new Map((signals ?? []).map(s => [s.student_id, s.churn_risk_score]));

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        icon={<Users size={24} className="text-gold" />}
        title={t("المستخدمون", "Users")}
        actions={
          <Link href="/admin/users/new" className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium">
            <Plus size={16} /> {t("إنشاء مستخدم", "New User")}
          </Link>
        }
      />
      <div className="mb-4">
        <SearchInput placeholder={t("ابحث بالاسم...", "Search by name...")} ariaLabel={t("بحث المستخدمين", "Search users")} />
      </div>
      <div className="mb-6 grid grid-cols-4 gap-3">
        {[
          { key: "all", l: t("الكل", "All"), v: allCount },
          { key: "students", l: t("طلاب", "Students"), v: students },
          { key: "teachers", l: t("معلمون", "Teachers"), v: teachers },
          { key: "admins", l: t("مدراء", "Admins"), v: admins },
        ].map(s => (
          <div key={s.key} className="glass-card rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-gold">{s.v}</p><p className="text-xs text-muted">{s.l}</p>
          </div>
        ))}
      </div>
      {users.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" aria-hidden="true" />}
          message={q ? t("لا نتائج لبحثك", "No matches for your search") : t("لا يوجد مستخدمون", "No users yet")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead><tr className="glass-thead">
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الاسم", "Name")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الدور", "Role")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الدولة", "Country")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الحالة", "Status")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("خطر التسرب", "Churn Risk")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("التسجيل", "Joined")}</th>
              <th scope="col" className="px-4 py-3 text-end font-medium text-muted">{t("إجراءات", "Actions")}</th>
            </tr></thead>
            <tbody>{users.map(u => <UserRow key={u.id} user={u} currentAdminId={user.id} churnRisk={u.role === "student" ? riskByStudent.get(u.id) ?? null : undefined} />)}</tbody>
          </table>
        </div>
      )}
      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label={t("ترقيم الصفحات", "Pagination")}>
          {page > 1 ? (
            <Link href={`/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`} className="glass-pill inline-flex items-center min-h-[44px] px-4 py-2 focus-ring">
              {t("السابق", "Previous")}
            </Link>
          ) : <span />}
          <span className="text-muted">{t(`صفحة ${page} من ${totalPages}`, `Page ${page} of ${totalPages}`)}</span>
          {page < totalPages ? (
            <Link href={`/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`} className="glass-pill inline-flex items-center min-h-[44px] px-4 py-2 focus-ring">
              {t("التالي", "Next")}
            </Link>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
