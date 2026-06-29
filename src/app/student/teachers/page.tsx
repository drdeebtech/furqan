import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { logError } from "@/lib/logger";
import { Skeleton } from "@/components/shared/skeleton";
import { getActiveTeacherSpecialties } from "@/lib/site-content/queries";
import { TeacherList } from "./teacher-list";
import { OnboardingWizard, type OnboardingPlan } from "./onboarding-wizard";
import { completeOnboarding } from "@/lib/actions/onboarding";
import type { TeacherData } from "./types";

export const metadata: Metadata = { title: "المعلمون" };

interface PageProps {
  searchParams: Promise<{ new?: string }>;
}

export default async function TeachersPage({ searchParams }: PageProps) {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const isNew = sp.new === "1";

  // Pull the student's most-recent recitation_standard alongside the
  // teachers list so each teacher card can highlight matching standards.
  // Without this, the student has no signal that "Hafs an Asim" on a
  // teacher card is the standard they're already studying.
  //
  // `onboarding_completed` + `subscription_plans` are only needed when the
  // dashboard guard sent us here for the 3-step wizard (new=1); fetching
  // them unconditionally would add two queries to every teachers-page
  // render for returning students.
  const [teachersRes, studentStandardRes, subscriptionRes] = await Promise.all([
    supabase
      .from("teacher_profiles")
      .select("teacher_id, bio, bio_en, specialties, recitation_standards, hourly_rate, rating_avg, total_sessions, gender")
      .eq("is_archived", false)
      .eq("is_accepting", true)
      .eq("cv_status", "approved")
      .order("rating_avg", { ascending: false })
      .returns<Omit<TeacherData, "name">[]>(),
    supabase
      .from("student_progress")
      .select("recitation_standard")
      .eq("student_id", user.id)
      .not("recitation_standard", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ recitation_standard: string | null }>(),
    supabase
      .from("subscriptions")
      .select("id")
      .eq("student_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  // Default: treat as already-onboarded so we never accidentally show the
  // wizard to a returning student who browsed without ?new=1.
  let onboardingCompleted = true;
  let plans: OnboardingPlan[] = [];
  if (isNew) {
    const [profileRes, plansRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .maybeSingle<{ onboarding_completed: boolean }>(),
      // Same source/query the public /pricing page uses — real catalog rows,
      // never fabricated tiers or prices.
      supabase
        .from("subscription_plans")
        .select("id, plan_code, name, monthly_credit_count, price_cents")
        .eq("is_active", true)
        .order("price_cents", { ascending: true })
        .returns<OnboardingPlan[]>(),
    ]);
    onboardingCompleted = !!profileRes.data?.onboarding_completed;
    if (plansRes.error) {
      logError("teachers page: subscription_plans fetch failed", plansRes.error, { tag: "onboarding" });
    } else if (plansRes.data) {
      plans = plansRes.data;
    }
  }

  const teachers = teachersRes.data;
  const studentStandard = studentStandardRes.data?.recitation_standard ?? null;
  const hasActiveSubscription = !!subscriptionRes.data;

  const list = teachers ?? [];

  let nameMap: Record<string, { name: string; nameAr: string | null }> = {};
  if (list.length > 0) {
    const ids = list.map((t) => t.teacher_id);
    const { data: profiles } = await supabase
      .from("public_profiles" as "profiles").select("id, full_name, full_name_ar").in("id", ids)
      .returns<{ id: string; full_name: string | null; full_name_ar: string | null }[]>();
    if (profiles) {
      nameMap = Object.fromEntries(
        profiles.map((p) => [
          p.id,
          { name: p.full_name ?? t("معلم", "Teacher"), nameAr: p.full_name_ar },
        ]),
      );
    }
  }

  const specialtyLabels = await getActiveTeacherSpecialties();

  const teacherData: TeacherData[] = list.map((r) => ({
    ...r,
    name: nameMap[r.teacher_id]?.name ?? t("معلم", "Teacher"),
    nameAr: nameMap[r.teacher_id]?.nameAr ?? null,
  }));

  // Returning students (onboarding already done) never see the wizard even
  // if they hand-navigate to ?new=1 — they get the plain browsable list.
  const showWizard = isNew && !onboardingCompleted;

  return (
    <Suspense
      fallback={
        <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
          <Skeleton className="mb-6 h-8 w-40" />
          <Skeleton className="mb-6 h-24 w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full" />
            ))}
          </div>
        </div>
      }
    >
      {showWizard ? (
        <OnboardingWizard
          teachers={teacherData}
          specialtyLabels={specialtyLabels}
          studentStandard={studentStandard}
          hasActiveSubscription={hasActiveSubscription}
          plans={plans}
          completeAction={completeOnboarding}
        />
      ) : (
        <TeacherList
          teachers={teacherData}
          specialtyLabels={specialtyLabels}
          studentStandard={studentStandard}
          hasActiveSubscription={hasActiveSubscription}
        />
      )}
    </Suspense>
  );
}
