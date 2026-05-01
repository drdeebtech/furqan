import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Plus, Calendar, Clock, DollarSign } from "lucide-react";
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
  title: string;
  scheduled_at: string;
  duration_min: number;
  session_type: SessionType;
  capacity: number;
  price_usd: number;
  status: string;
}

export default async function TeacherClassesPage() {
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: offerings } = await supabase
    .from("class_offerings")
    .select("id, title, scheduled_at, duration_min, session_type, capacity, price_usd, status")
    .eq("teacher_id", user.id)
    .order("scheduled_at", { ascending: false })
    .returns<OfferingRow[]>();

  // Pull enrollment counts per offering (one round-trip).
  const offeringIds = (offerings ?? []).map(o => o.id);
  const enrollment: Record<string, number> = {};
  if (offeringIds.length > 0) {
    const { data: enrollRows } = await supabase
      .from("bookings")
      .select("class_offering_id")
      .in("class_offering_id", offeringIds)
      .returns<{ class_offering_id: string }[]>();
    for (const r of enrollRows ?? []) {
      enrollment[r.class_offering_id] = (enrollment[r.class_offering_id] ?? 0) + 1;
    }
  }

  const STATUS_LABEL: Record<string, { ar: string; en: string; cls: string }> = {
    open:       { ar: "مفتوحة",   en: "Open",      cls: "border-success/30 bg-success/10 text-success" },
    full:       { ar: "ممتلئة",    en: "Full",      cls: "border-warning/30 bg-warning/10 text-warning" },
    confirmed:  { ar: "مؤكدة",    en: "Confirmed", cls: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
    cancelled:  { ar: "ملغاة",    en: "Cancelled", cls: "border-error/30 bg-error/10 text-red-400" },
    completed:  { ar: "منتهية",   en: "Completed", cls: "border-muted/30 bg-muted/10 text-muted" },
  };

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Users size={24} className="text-gold" />
          {t("الجلسات الجماعية", "Group Classes")}
        </h1>
        <Link
          href="/teacher/classes/new"
          className="flex items-center gap-2 glass-gold glass-pill px-4 py-2 text-sm font-medium text-white"
        >
          <Plus size={16} aria-hidden="true" />
          {t("جلسة جديدة", "New class")}
        </Link>
      </div>

      {(offerings ?? []).length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Users size={32} className="mx-auto mb-3 text-muted" aria-hidden="true" />
          <p className="text-muted">
            {t(
              "لم تقم بإنشاء أي جلسة جماعية بعد.",
              "You haven't created any group classes yet.",
            )}
          </p>
          <Link
            href="/teacher/classes/new"
            className="mt-4 inline-block text-sm text-gold hover:text-gold-hover"
          >
            {t("أنشئ أول جلسة جماعية ←", "Create your first group class →")}
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {(offerings ?? []).map((o) => {
            const enrolled = enrollment[o.id] ?? 0;
            const meta = STATUS_LABEL[o.status] ?? { ar: o.status, en: o.status, cls: "border-muted/30 text-muted" };
            return (
              <li key={o.id} className="glass-card rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">{o.title}</p>
                    <p className="mt-1 text-xs text-gold">
                      {lang === "ar" ? SESSION_TYPE_AR[o.session_type] : SESSION_TYPE_EN[o.session_type]}
                    </p>
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
                        {enrolled} / {o.capacity}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <DollarSign size={12} aria-hidden="true" />
                        {o.price_usd.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <span className={`glass-badge ${meta.cls}`}>
                    {lang === "ar" ? meta.ar : meta.en}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
