import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  CheckCircle,
  BookOpen,
  Package as PackageIcon,
  Star,
  Clock,
  Eye,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "معاينة كمستخدم · Impersonate Preview",
};

interface TargetProfile {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

interface BookingRow {
  id: string;
  teacher_id: string;
  scheduled_at: string;
  duration_min: number;
  status: string;
  session_type: string;
  amount_usd: number;
}

interface PackageRow {
  id: string;
  sessions_total: number;
  sessions_used: number;
  status: string;
  expires_at: string | null;
  packages: { name: string; name_ar: string } | null;
}

interface HomeworkRow {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  created_at: string;
}

interface EvaluationRow {
  id: string;
  evaluation_type: string;
  overall_score: number | null;
  created_at: string;
}

interface ProfileName {
  id: string;
  full_name: string | null;
}

export default async function AdminAsUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!adminProfile || adminProfile.role !== "admin") redirect("/login");

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, full_name, email, role, phone, is_active, created_at")
    .eq("id", id)
    .single<TargetProfile>();

  if (!target) notFound();

  const now = new Date().toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  if (target.role === "student") {
    const [nextRes, recentRes, packagesRes, homeworkRes, evalsRes] = await Promise.all([
      admin
        .from("bookings")
        .select("id, teacher_id, scheduled_at, duration_min, status, session_type, amount_usd")
        .eq("student_id", id)
        .gte("scheduled_at", now)
        .in("status", ["pending", "confirmed"])
        .order("scheduled_at", { ascending: true })
        .limit(3)
        .returns<BookingRow[]>(),
      admin
        .from("bookings")
        .select("id, teacher_id, scheduled_at, duration_min, status, session_type, amount_usd")
        .eq("student_id", id)
        .gte("scheduled_at", thirtyDaysAgo)
        .order("scheduled_at", { ascending: false })
        .limit(10)
        .returns<BookingRow[]>(),
      admin
        .from("student_packages")
        .select("id, sessions_total, sessions_used, status, expires_at, packages(name, name_ar)")
        .eq("student_id", id)
        .order("purchased_at", { ascending: false })
        .limit(5)
        .returns<PackageRow[]>(),
      admin
        .from("homework_assignments")
        .select("id, title, status, due_at, created_at")
        .eq("student_id", id)
        .order("created_at", { ascending: false })
        .limit(10)
        .returns<HomeworkRow[]>(),
      admin
        .from("session_evaluations")
        .select("id, evaluation_type, overall_score, created_at")
        .eq("student_id", id)
        .order("created_at", { ascending: false })
        .limit(5)
        .returns<EvaluationRow[]>(),
    ]);

    const nextBookings = nextRes.data ?? [];
    const recent = recentRes.data ?? [];
    const packages = packagesRes.data ?? [];
    const homework = homeworkRes.data ?? [];
    const evaluations = evalsRes.data ?? [];

    const teacherIds = new Set<string>();
    for (const b of [...nextBookings, ...recent]) teacherIds.add(b.teacher_id);
    const { data: teacherProfiles } =
      teacherIds.size > 0
        ? await admin
            .from("profiles")
            .select("id, full_name")
            .in("id", Array.from(teacherIds))
            .returns<ProfileName[]>()
        : { data: [] as ProfileName[] };
    const teacherNames = new Map<string, string>();
    for (const p of teacherProfiles ?? []) teacherNames.set(p.id, p.full_name ?? "—");

    return (
      <PreviewFrame target={target}>
        <section className="grid gap-4 md:grid-cols-2">
          <Card icon={Calendar} label="الجلسات القادمة" value={nextBookings.length}>
            {nextBookings.length === 0 ? (
              <p className="text-xs text-muted">لا يوجد جلسات قادمة.</p>
            ) : (
              <ul className="space-y-2">
                {nextBookings.map((b) => (
                  <li key={b.id} className="text-xs text-muted">
                    <span className="text-foreground">{teacherNames.get(b.teacher_id) ?? "—"}</span>{" "}
                    · {new Date(b.scheduled_at).toLocaleString()} · {b.duration_min}د · {b.status}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card icon={PackageIcon} label="الباقات النشطة" value={packages.filter((p) => p.status === "active").length}>
            {packages.length === 0 ? (
              <p className="text-xs text-muted">لا يوجد باقات.</p>
            ) : (
              <ul className="space-y-2">
                {packages.map((p) => {
                  const remaining = p.sessions_total - p.sessions_used;
                  return (
                    <li key={p.id} className="text-xs text-muted">
                      <span className="text-foreground">{p.packages?.name_ar ?? p.packages?.name ?? "—"}</span>
                      {" · "}
                      {remaining}/{p.sessions_total} متبقي
                      {" · "}
                      {p.status}
                      {p.expires_at && ` · تنتهي ${new Date(p.expires_at).toLocaleDateString()}`}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card icon={BookOpen} label="الواجبات" value={homework.length}>
            {homework.length === 0 ? (
              <p className="text-xs text-muted">لا يوجد واجبات.</p>
            ) : (
              <ul className="space-y-2">
                {homework.slice(0, 5).map((h) => (
                  <li key={h.id} className="text-xs text-muted">
                    <span className="text-foreground">{h.title}</span> · {h.status}
                    {h.due_at && ` · يُسلَّم ${new Date(h.due_at).toLocaleDateString()}`}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card icon={Star} label="آخر التقييمات" value={evaluations.length}>
            {evaluations.length === 0 ? (
              <p className="text-xs text-muted">لا يوجد تقييمات.</p>
            ) : (
              <ul className="space-y-2">
                {evaluations.map((e) => (
                  <li key={e.id} className="text-xs text-muted">
                    <span className="text-foreground">
                      {e.overall_score !== null ? e.overall_score.toFixed(2) : "—"}/5
                    </span>
                    {" · "}
                    {e.evaluation_type}
                    {" · "}
                    {new Date(e.created_at).toLocaleDateString()}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <section className="mt-6 rounded-2xl border border-surface-border/60 bg-surface/40 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Clock size={16} className="text-gold" />
            <h2 className="text-sm font-bold">آخر 30 يوماً من الحجوزات</h2>
          </div>
          {recent.length === 0 ? (
            <p className="text-xs text-muted">لا يوجد نشاط في آخر 30 يوماً.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="p-2 text-start">المعلم</th>
                  <th className="p-2 text-start">الموعد</th>
                  <th className="p-2 text-start">النوع</th>
                  <th className="p-2 text-start">الحالة</th>
                  <th className="p-2 text-start">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((b) => (
                  <tr key={b.id} className="border-t border-surface-border/60">
                    <td className="p-2 text-foreground">{teacherNames.get(b.teacher_id) ?? "—"}</td>
                    <td className="p-2 text-muted">{new Date(b.scheduled_at).toLocaleString()}</td>
                    <td className="p-2 text-muted">{b.session_type}</td>
                    <td className="p-2 text-muted">{b.status}</td>
                    <td className="p-2 text-gold">${b.amount_usd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </PreviewFrame>
    );
  }

  // Teacher / admin / moderator preview is just a stub for now.
  return (
    <PreviewFrame target={target}>
      <p className="rounded-2xl border border-surface-border/60 bg-surface/40 p-6 text-sm text-muted">
        معاينة دور &quot;{target.role}&quot; ستُضاف في المرحلة القادمة.
        <br />
        للانتقال إلى الملف الكامل استخدم{" "}
        <Link href={`/admin/users/${target.id}`} className="text-gold hover:text-gold-light">
          صفحة الملف
        </Link>
        {" "}أو{" "}
        <Link href={`/admin/users/${target.id}/timeline`} className="text-gold hover:text-gold-light">
          الجدول الزمني
        </Link>
        .
      </p>
    </PreviewFrame>
  );
}

function PreviewFrame({
  target,
  children,
}: {
  target: TargetProfile;
  children: React.ReactNode;
}) {
  return (
    <div dir="rtl">
      <div className="sticky top-0 z-50 border-b border-gold/40 bg-gold/10 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Eye size={16} className="text-gold" />
            <span className="font-bold text-gold">معاينة كـ {target.full_name ?? "مستخدم"}</span>
            <span className="text-xs text-muted">
              ({target.role}) · {target.email} · للقراءة فقط
            </span>
          </div>
          <Link
            href={`/admin/users/${target.id}`}
            className="inline-flex items-center gap-1 rounded-lg border border-surface-border/60 px-3 py-1.5 text-xs text-muted transition-colors hover:border-gold/40 hover:text-gold"
          >
            <ArrowRight size={12} className="rotate-180" /> الخروج من المعاينة
          </Link>
        </div>
      </div>

      <div className="admin-readonly pointer-events-none mx-auto max-w-6xl px-4 py-6 opacity-95">
        {children}
      </div>
    </div>
  );
}

function Card({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-surface-border/60 bg-surface/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} className="text-gold" />
        <h2 className="text-sm font-bold">{label}</h2>
        <span className="rounded-full bg-surface/60 px-2 py-0.5 text-xs text-muted">{value}</span>
      </div>
      {children}
    </article>
  );
}
