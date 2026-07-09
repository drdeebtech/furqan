import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { getT } from "@/lib/i18n/server";
import { getActiveTeacherSpecialties } from "@/lib/site-content/queries";
import { BookingForm } from "./booking-form";

export const metadata: Metadata = { title: "حجز جديد" };

interface Props {
  searchParams: Promise<{ teacher?: string }>;
}

interface AvailSlot {
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration: number;
}

export default async function NewBookingPage({ searchParams }: Props) {
  const { teacher: teacherId } = await searchParams;
  if (!teacherId) redirect("/student/teachers");

  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [tpRes, profileRes, availRes, specialtyLabels, activeSubRes, prepaidRes] = await Promise.all([
    supabase
      .from("teacher_profiles")
      .select("teacher_id, hourly_rate, specialties, recitation_standards, bio")
      .eq("teacher_id", teacherId)
      .eq("is_archived", false)
      .eq("is_accepting", true)
      .single<{
        teacher_id: string;
        hourly_rate: number;
        specialties: string[];
        recitation_standards: string[];
        bio: string | null;
      }>(),
    supabase
      .from("profiles")
      .select("full_name, full_name_ar")
      .eq("id", teacherId)
      .single<{ full_name: string | null; full_name_ar: string | null }>(),
    supabase
      .from("teacher_availability")
      .select("day_of_week, start_time, end_time, slot_duration")
      .eq("teacher_id", teacherId)
      .eq("is_active", true)
      .returns<AvailSlot[]>(),
    getActiveTeacherSpecialties(),
    // Spec 038 (T6.3) — the source picker only makes sense when the student
    // has BOTH a spendable subscription and a spendable prepaid wallet. Head
    // count of active subscriptions is enough; the row itself isn't needed.
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("student_id", user.id)
      .eq("status", "active")
      .limit(1),
    // Active prepaid_hours lots with remaining credit. `product_type` isn't in
    // the hand-corrected database.ts / generated types yet — localized cast
    // (same shape as src/lib/views/student-dashboard.ts) loosens column-name
    // checking without touching the types files. `sessions_remaining` is a
    // GENERATED column, so remaining = sessions_total − sessions_used is
    // computed in TS (matches the dashboard precedent).
    (supabase as unknown as {
      from(t: string): {
        select(c: string): {
          eq(c: string, v: string): {
            eq(c: string, v: string): {
              eq(c: string, v: string): Promise<{
                data: { sessions_total: number; sessions_used: number }[] | null;
                error: { message: string; code?: string } | null;
              }>;
            };
          };
        };
      };
    })
      .from("student_packages")
      .select("sessions_total, sessions_used")
      .eq("student_id", user.id)
      .eq("product_type", "prepaid_hours")
      .eq("status", "active"),
  ]);

  if (!tpRes.data) redirect("/student/teachers");

  const teacher = {
    id: tpRes.data.teacher_id,
    fullName: profileRes.data?.full_name ?? null,
    fullNameAr: profileRes.data?.full_name_ar ?? null,
    fallbackName: t("معلم", "Teacher"),
    hourlyRate: Number(tpRes.data.hourly_rate),
    specialties: tpRes.data.specialties,
    recitationStandards: tpRes.data.recitation_standards,
    bio: tpRes.data.bio,
  };

  const availability = (availRes.data ?? []).map((s) => ({
    dayOfWeek: s.day_of_week,
    startTime: s.start_time,
    endTime: s.end_time,
    slotDuration: s.slot_duration,
  }));

  const hasActiveSubscription = (activeSubRes.count ?? 0) > 0;
  const { data: prepaidRows, error: prepaidError } = prepaidRes;
  if (prepaidError) {
    logError("student booking: prepaid-hours lookup failed", prepaidError, {
      route: "/student/bookings/new",
      widget: "prepaid-source-picker",
    });
  }
  const hasPrepaidHours = (prepaidRows ?? []).some(
    (p) => p.sessions_total - p.sessions_used > 0,
  );
  const canChoosePrepaid = hasActiveSubscription && hasPrepaidHours;

  return (
    <div dir={dir} className="mx-auto max-w-2xl px-4 py-8">
      <BookingForm
        teacher={teacher}
        availability={availability}
        specialtyLabels={specialtyLabels}
        canChoosePrepaid={canChoosePrepaid}
      />
    </div>
  );
}
