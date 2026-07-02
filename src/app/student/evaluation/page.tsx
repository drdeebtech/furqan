import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CalendarCheck, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { TRIAL_POLICY, SESSION_DURATION } from "@/lib/copy/policies";
import { BookEvaluationForm } from "./book-evaluation-form";

export const metadata: Metadata = { title: "جلسة التقييم المجانية" };

interface ActiveEvaluation {
  id: string;
  status: string;
  specialty: string | null;
  scheduled_at: string | null;
}

/**
 * Trust roadmap Wave 2 — the free-evaluation booking surface (decision 40).
 * The public RegisterBanner CTAs land here; logged-out visitors bounce
 * through /login and return. States:
 *   • active evaluation exists → status card (one per student — E1/G5)
 *   • none → booking form (POSTs to /api/stripe/checkout/single-session)
 */
export default async function EvaluationPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/student/evaluation");

  // Own-row read (RLS). Same active predicate as the E1 unique index:
  // cancelled / no_show don't consume the attempt (G5 — re-booking allowed).
  const { data: active, error } = await supabase
    .from("bookings")
    .select("id, status, specialty, scheduled_at")
    .eq("student_id", user.id)
    .eq("booking_product_type", "assessment")
    .not("status", "in", '("cancelled","no_show")')
    .limit(1)
    .maybeSingle<ActiveEvaluation>();

  if (error) {
    // Fail visible, not blank: surface a retry message rather than silently
    // rendering the booking form (which would then 409 on submit anyway).
    return (
      <div dir={dir} className="mx-auto max-w-2xl px-4 py-10">
        <p role="alert" className="rounded-lg glass-danger p-4 text-sm text-error">
          {t(
            "تعذر تحميل حالة جلسة التقييم — حدّث الصفحة أو حاول لاحقاً.",
            "Could not load your evaluation status — refresh the page or try again later.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div dir={dir} className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">
        {t("جلسة التقييم المجانية", "Free evaluation session")}
      </h1>
      <p className="mt-3 text-muted">
        {t(TRIAL_POLICY.long.ar, TRIAL_POLICY.long.en)}
      </p>
      <p className="mt-1 text-sm text-muted">
        {t(SESSION_DURATION.evaluation.ar, SESSION_DURATION.evaluation.en)}
      </p>

      {active ? (
        <div className="mt-8 rounded-2xl border border-gold/20 bg-surface/40 p-6">
          <div className="flex items-center gap-3">
            <CalendarCheck className="text-gold" size={22} aria-hidden="true" />
            <h2 className="font-semibold">
              {t("جلسة التقييم الخاصة بك محجوزة بالفعل", "Your evaluation session is already booked")}
            </h2>
          </div>
          <p className="mt-3 text-sm text-muted">
            {t(
              "لكل طالب جلسة تقييم واحدة. إذا أُلغيت جلستك يمكنك الحجز من جديد.",
              "Each student gets one evaluation session. If yours is cancelled you can book again.",
            )}
          </p>
          <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted">
            <MessageCircle size={16} aria-hidden="true" />
            {t(
              "سيتواصل معك فريقنا عبر واتساب لتأكيد الموعد.",
              "Our team will contact you on WhatsApp to confirm the time.",
            )}
          </p>
          <div className="mt-5">
            <Link
              href="/student/bookings"
              className="glass-gold glass-pill inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-background hover:bg-gold-hover focus-ring"
            >
              {t("عرض حجوزاتي", "View my bookings")}
            </Link>
          </div>
        </div>
      ) : (
        <BookEvaluationForm />
      )}
    </div>
  );
}
