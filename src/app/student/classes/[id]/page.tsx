import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Calendar, Clock, Users, DollarSign, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { SESSION_TYPE_AR } from "@/lib/constants";
import type { SessionType } from "@/types/database";
import { EnrollButton } from "./enroll-button";

export const metadata: Metadata = { title: "تفاصيل الجلسة الجماعية" };

const SESSION_TYPE_EN: Record<SessionType, string> = {
  hifz: "Hifz", muraja: "Review", tajweed: "Tajweed", tilawa: "Tilawa",
  qiraat: "Qiraat", tafsir: "Tafsir", combined: "Hifz + Review", other: "Other",
};

interface Props { params: Promise<{ id: string }> }

export default async function StudentOfferingDetailPage({ params }: Props) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const locale = lang === "ar" ? "ar-EG" : "en-US";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: offering } = await supabase
    .from("class_offerings")
    .select("id, teacher_id, title, description, scheduled_at, duration_min, session_type, capacity, price_usd, status")
    .eq("id", id)
    .single<{
      id: string; teacher_id: string; title: string; description: string | null;
      scheduled_at: string; duration_min: number; session_type: SessionType;
      capacity: number; price_usd: number; status: string;
    }>();
  if (!offering) redirect("/student/classes");

  const { data: teacher } = await supabase
    .from("public_profiles" as "profiles").select("id, full_name").eq("id", offering.teacher_id)
    .single<{ id: string; full_name: string | null }>();

  const { data: alreadyEnrolled } = await supabase
    .from("bookings")
    .select("id")
    .eq("class_offering_id", id)
    .eq("student_id", user.id)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();

  const enrolled = !!alreadyEnrolled;
  const closed = offering.status !== "open";
  const past = Date.parse(offering.scheduled_at) < Date.now();

  return (
    <div dir={dir} className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href="/student/classes"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gold transition-colors hover:text-gold-hover"
      >
        <ArrowRight size={14} />
        {t("العودة للجلسات الجماعية", "Back to group classes")}
      </Link>

      <div className="glass-card p-6">
        <h1 className="text-2xl font-bold">{offering.title}</h1>
        <p className="mt-2 text-sm text-gold">
          {lang === "ar" ? SESSION_TYPE_AR[offering.session_type] : SESSION_TYPE_EN[offering.session_type]}
        </p>
        {offering.description && (
          <p className="mt-4 text-sm leading-relaxed text-muted-light">{offering.description}</p>
        )}

        <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <User size={14} className="text-muted" aria-hidden="true" />
            <div>
              <dt className="text-xs text-muted">{t("المعلم", "Teacher")}</dt>
              <dd className="font-medium">{teacher?.full_name ?? "—"}</dd>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-muted" aria-hidden="true" />
            <div>
              <dt className="text-xs text-muted">{t("الوقت", "When")}</dt>
              <dd className="font-medium" dir="ltr">
                {new Date(offering.scheduled_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
              </dd>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-muted" aria-hidden="true" />
            <div>
              <dt className="text-xs text-muted">{t("المدة", "Duration")}</dt>
              <dd className="font-medium">{offering.duration_min} {t("دقيقة", "min")}</dd>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Users size={14} className="text-muted" aria-hidden="true" />
            <div>
              <dt className="text-xs text-muted">{t("السعة", "Capacity")}</dt>
              <dd className="font-medium">{offering.capacity} {t("طالباً", "students")}</dd>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign size={14} className="text-muted" aria-hidden="true" />
            <div>
              <dt className="text-xs text-muted">{t("السعر", "Price")}</dt>
              <dd className="font-medium">${offering.price_usd.toFixed(2)} {t("(أو حصة من باقتك)", "(or 1 credit from your package)")}</dd>
            </div>
          </div>
        </dl>

        <div className="mt-8 border-t border-[var(--surface-border)] pt-6">
          {enrolled ? (
            <p className="text-sm font-medium text-success">
              ✓ {t("أنت مُسجَّل في هذه الجلسة. ستظهر في جلساتك القادمة.", "You're enrolled. This will appear in your upcoming sessions.")}
            </p>
          ) : closed ? (
            <p className="text-sm text-warning">
              {t("التسجيل مغلق لهذه الجلسة.", "Enrollment is closed for this class.")}
            </p>
          ) : past ? (
            <p className="text-sm text-muted">
              {t("هذه الجلسة في الماضي.", "This class is in the past.")}
            </p>
          ) : (
            <EnrollButton offeringId={offering.id} />
          )}
        </div>
      </div>
    </div>
  );
}
