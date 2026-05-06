import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Tags, Globe, Award, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PicklistEditor } from "./picklist-editor";
import type { TeacherLanguage } from "@/lib/site-content/types";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "قوائم المعلمين" };

export default async function AdminPicklistsPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [langsRes, specsRes, recsRes] = await Promise.all([
    supabase.from("teacher_languages").select("*").order("sort_order"),
    supabase.from("teacher_specialties").select("*").order("sort_order"),
    supabase.from("teacher_recitations").select("*").order("sort_order"),
  ]);
  const languages = (langsRes.data ?? []) as TeacherLanguage[];
  const specialties = (specsRes.data ?? []) as TeacherLanguage[];
  const recitations = (recsRes.data ?? []) as TeacherLanguage[];

  return (
    <main dir={dir} className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Tags size={24} className="text-gold" aria-hidden="true" />}
        title={t("قوائم المعلمين", "Teacher Picklists")}
        subtitle={t(
          "اللغات والتخصصات والقراءات الظاهرة في نماذج تسجيل المعلمين والسيرة الذاتية. التعديل ينعكس فوراً.",
          "Languages, specialties, and recitations shown in teacher signup + CV forms. Changes propagate immediately.",
        )}
      />

      <section className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Globe size={18} className="text-gold" aria-hidden="true" />
          {t("اللغات", "Languages")}
          <span className="text-xs font-normal text-muted">({languages.length})</span>
        </h2>
        <PicklistEditor table="teacher_languages" rows={languages} />
      </section>

      <section className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <BookOpen size={18} className="text-gold" aria-hidden="true" />
          {t("التخصصات", "Specialties")}
          <span className="text-xs font-normal text-muted">({specialties.length})</span>
        </h2>
        <PicklistEditor table="teacher_specialties" rows={specialties} />
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Award size={18} className="text-gold" aria-hidden="true" />
          {t("القراءات", "Recitations")}
          <span className="text-xs font-normal text-muted">({recitations.length})</span>
        </h2>
        <PicklistEditor table="teacher_recitations" rows={recitations} />
      </section>
    </main>
  );
}
