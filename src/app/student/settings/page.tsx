import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings, User, KeyRound, Mail, Calendar, BookOpen, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { AccountForm } from "./account-form";
import { PasswordChangeForm } from "@/components/shared/password-change-form";
import { EmailChangeForm } from "@/components/shared/email-change-form";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "إعداداتي" };

interface ProfileRow {
  full_name: string | null;
  full_name_ar: string | null;
  phone: string | null;
  country: string | null;
  timezone: string | null;
  lang: string | null;
  date_of_birth: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  guardian_link_code: string | null;
}

export default async function StudentSettingsPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "full_name, full_name_ar, phone, country, timezone, lang, date_of_birth, parent_name, parent_phone, parent_email, guardian_link_code",
    )
    .eq("id", user.id)
    .single<ProfileRow>();
  if (!profile) redirect("/student/dashboard");

  return (
    <main dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={<Settings size={24} className="text-gold" aria-hidden="true" />}
        title={t("إعداداتي", "My Settings")}
        subtitle={t(
          "تحكم في بياناتك الشخصية، بيانات ولي الأمر، وكلمة المرور.",
          "Manage your personal info, guardian contact, and password.",
        )}
      />

      <section className="glass-card mb-6 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <User size={18} className="text-gold" aria-hidden="true" />
          {t("الحساب الشخصي", "Personal Info")}
        </h2>
        <AccountForm profile={profile} />
      </section>

      <section className="glass-card mb-6 p-6">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <Users size={18} className="text-gold" aria-hidden="true" />
          {t("رمز ربط ولي الأمر", "Guardian Link Code")}
        </h2>
        <p className="mb-3 text-sm text-foreground/70">
          {t(
            "شارك هذا الرمز مع ولي أمرك فقط. يحتاجه—مع بريدك الإلكتروني—لربط حسابه بحسابك ومتابعة تقدّمك. لا تشاركه مع أي شخص آخر.",
            "Share this code with your guardian only. They need it — together with your email — to link to your account and follow your progress. Do not share it with anyone else.",
          )}
        </p>
        <code
          dir="ltr"
          className="inline-block rounded-lg border border-[var(--surface-border)] bg-foreground/5 px-4 py-2 font-mono text-lg tracking-[0.3em]"
        >
          {profile.guardian_link_code ?? t("غير متاح", "unavailable")}
        </code>
      </section>

      <section className="glass-card mb-6 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Mail size={18} className="text-gold" aria-hidden="true" />
          {t("البريد الإلكتروني", "Email")}
        </h2>
        <EmailChangeForm currentEmail={user.email ?? ""} />
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
          <Link href="/student/bookings" className="flex min-h-[44px] items-center gap-3 rounded-xl border border-[var(--surface-border)] p-3 transition-colors hover:border-gold/30 hover:bg-foreground/5">
            <Calendar size={16} className="shrink-0 text-gold" aria-hidden="true" />
            <span className="text-sm">{t("حجوزاتي", "My Bookings")}</span>
          </Link>
          <Link href="/student/follow-up" className="flex min-h-[44px] items-center gap-3 rounded-xl border border-[var(--surface-border)] p-3 transition-colors hover:border-gold/30 hover:bg-foreground/5">
            <BookOpen size={16} className="shrink-0 text-gold" aria-hidden="true" />
            <span className="text-sm">{t("المتابعة", "Follow-up")}</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
