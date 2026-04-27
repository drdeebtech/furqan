import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings, User, KeyRound, ToggleRight, Camera, FileText, Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { AccountForm } from "./account-form";
import { TeachingStatusForm } from "./teaching-status-form";
import { PasswordChangeForm } from "@/components/shared/password-change-form";

export const metadata: Metadata = { title: "إعداداتي" };

interface ProfileRow {
  full_name: string | null;
  full_name_ar: string | null;
  phone: string | null;
  country: string | null;
  timezone: string | null;
  lang: string | null;
  date_of_birth: string | null;
}

export default async function TeacherSettingsPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profileRes, tpRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, full_name_ar, phone, country, timezone, lang, date_of_birth")
      .eq("id", user.id)
      .single<ProfileRow>(),
    supabase
      .from("teacher_profiles")
      .select("is_accepting")
      .eq("teacher_id", user.id)
      .single<{ is_accepting: boolean }>(),
  ]);

  const profile = profileRes.data;
  if (!profile) redirect("/teacher/dashboard");
  const isAccepting = tpRes.data?.is_accepting ?? true;

  return (
    <main dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-2">
        <Settings size={24} className="text-gold" aria-hidden="true" />
        <h1 className="text-2xl font-bold">{t("إعداداتي", "My Settings")}</h1>
      </div>
      <p className="mb-8 text-sm text-muted">
        {t(
          "تحكم في بياناتك الشخصية، حالة التدريس، وكلمة المرور.",
          "Manage your personal info, teaching status, and password.",
        )}
      </p>

      <section className="glass-card mb-6 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <User size={18} className="text-gold" aria-hidden="true" />
          {t("الحساب الشخصي", "Personal Info")}
        </h2>
        <AccountForm profile={profile} />
      </section>

      <section className="glass-card mb-6 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <ToggleRight size={18} className="text-gold" aria-hidden="true" />
          {t("حالة التدريس", "Teaching Status")}
        </h2>
        <TeachingStatusForm initialIsAccepting={isAccepting} />
      </section>

      <section className="glass-card mb-6 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <KeyRound size={18} className="text-gold" aria-hidden="true" />
          {t("كلمة المرور", "Password")}
        </h2>
        <PasswordChangeForm />
      </section>

      <section className="glass-card p-6">
        <h2 className="mb-4 text-lg font-semibold">
          {t("روابط سريعة", "Quick Links")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/teacher/cv" className="flex min-h-[44px] items-center gap-3 rounded-xl border border-[var(--surface-border)] p-3 transition-colors hover:border-gold/30 hover:bg-foreground/5">
            <Camera size={16} className="shrink-0 text-gold" aria-hidden="true" />
            <span className="text-sm">{t("الصورة + السيرة الذاتية", "Photo + CV")}</span>
          </Link>
          <Link href="/teacher/cv" className="flex min-h-[44px] items-center gap-3 rounded-xl border border-[var(--surface-border)] p-3 transition-colors hover:border-gold/30 hover:bg-foreground/5">
            <FileText size={16} className="shrink-0 text-gold" aria-hidden="true" />
            <span className="text-sm">{t("التخصصات والقراءات", "Specialties & Recitations")}</span>
          </Link>
          <Link href="/teacher/availability" className="flex min-h-[44px] items-center gap-3 rounded-xl border border-[var(--surface-border)] p-3 transition-colors hover:border-gold/30 hover:bg-foreground/5">
            <Calendar size={16} className="shrink-0 text-gold" aria-hidden="true" />
            <span className="text-sm">{t("المواعيد", "Availability")}</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
