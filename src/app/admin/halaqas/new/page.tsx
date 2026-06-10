import type { Metadata } from "next";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import { HalaqaForm } from "./halaqa-form";

export const metadata: Metadata = { title: "إنشاء حلقة" };

interface TeacherOption {
  id: string;
  full_name: string | null;
}

export default async function NewHalaqaPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();

  // Approved + accepting + non-archived teachers (matches the public
  // listing eligibility rules from v15_003 RLS).
  const { data: teachers } = await supabase
    .from("teacher_profiles")
    .select("teacher_id, profiles!inner(id, full_name)")
    .eq("cv_status", "approved")
    .eq("is_archived", false)
    .eq("is_accepting", true)
    .returns<{ teacher_id: string; profiles: TeacherOption }[]>();

  const teacherOptions: TeacherOption[] = (teachers ?? []).map((t) => ({
    id: t.teacher_id,
    full_name: t.profiles.full_name,
  }));

  return (
    <main dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Users size={24} className="text-gold" />}
        title={t("إنشاء حلقة جديدة", "Create New Halaqa")}
        subtitle={t(
          "حلقة جماعية لمعلم واحد ومجموعة طلاب. سيتم إنشاء غرفة فيديو خاصة بالحلقة بعد الحفظ.",
          "Group session for one teacher and a roster of enrolled students. A dedicated group video room is provisioned on save.",
        )}
      />
      <HalaqaForm teachers={teacherOptions} />
    </main>
  );
}
