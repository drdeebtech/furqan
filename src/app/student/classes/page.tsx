import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Calendar, Clock, DollarSign } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";

export const metadata: Metadata = { title: "الجلسات الجماعية" };

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

interface OfferingRow {
  id: string;
  teacher_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  duration_min: number;
  session_type: SessionType;
  capacity: number;
  price_usd: number;
  status: string;
}

export default async function StudentClassesBrowsePage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Open + future offerings only. RLS policy "student read open offerings"
  // already returns rows in (open, full, confirmed) — we tighten to 'open'
  // here since you can only enroll in open ones; full/confirmed are shown
  // in a separate "your enrollments" list later.
  const { data: offerings } = await supabase
    .from("class_offerings")
    .select("id, teacher_id, title, description, scheduled_at, duration_min, session_type, capacity, price_usd, status")
    .eq("status", "open")
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .returns<OfferingRow[]>();

  // Teacher names + per-offering enrollment counts
  const teacherIds = Array.from(new Set((offerings ?? []).map(o => o.teacher_id)));
  const offeringIds = (offerings ?? []).map(o => o.id);
  const [teachersRes, alreadyRes] = await Promise.all([
    teacherIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", teacherIds)
          .returns<{ id: string; full_name: string | null }[]>()
      : Promise.resolve({ data: [] }),
    offeringIds.length > 0
      ? supabase.from("bookings")
          .select("class_offering_id")
          .in("class_offering_id", offeringIds)
          .eq("student_id", user.id)
          .is("deleted_at", null)
          .returns<{ class_offering_id: string }[]>()
      : Promise.resolve({ data: [] }),
  ]);
  const teacherName = new Map((teachersRes.data ?? []).map(p => [p.id, p.full_name ?? t("معلم", "Teacher")]));
  const alreadyEnrolled = new Set((alreadyRes.data ?? []).map(r => r.class_offering_id));

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-2 flex items-center gap-2 text-2xl font-bold">
        <Users size={24} className="text-gold" />
        {t("الجلسات الجماعية", "Group classes")}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {t(
          "تصفَّح الجلسات الجماعية المتاحة وسجِّل بضغطة واحدة.",
          "Browse upcoming group classes and enroll in one click.",
        )}
      </p>

      {(offerings ?? []).length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Users size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">
            {t(
              "لا توجد جلسات جماعية متاحة حالياً. تابعنا قريباً.",
              "No group classes available right now. Check back soon.",
            )}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {(offerings ?? []).map((o) => (
            <li key={o.id} className="glass-card rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">{o.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {teacherName.get(o.teacher_id) ?? "—"}
                    <span className="mx-2">·</span>
                    <span className="text-gold">
                      {lang === "ar" ? SESSION_TYPE_AR[o.session_type] : SESSION_TYPE_EN[o.session_type]}
                    </span>
                  </p>
                  {o.description && (
                    <p className="mt-2 text-xs text-muted-light">{o.description}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={12} aria-hidden="true" />
                      {new Date(o.scheduled_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} aria-hidden="true" />
                      {o.duration_min} {t("دقيقة", "min")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users size={12} aria-hidden="true" />
                      {t("سعة", "capacity")} {o.capacity}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <DollarSign size={12} aria-hidden="true" />
                      {o.price_usd.toFixed(2)}
                    </span>
                  </div>
                </div>
                <Link
                  href={`/student/classes/${o.id}`}
                  className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    alreadyEnrolled.has(o.id)
                      ? "glass border-success/30 text-success cursor-default"
                      : "glass-gold text-white hover:bg-gold-hover"
                  }`}
                >
                  {alreadyEnrolled.has(o.id)
                    ? t("مُسجَّل ✓", "Enrolled ✓")
                    : t("التفاصيل", "View details")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
