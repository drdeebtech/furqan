import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings, User, KeyRound, Mail, Calendar, BookOpen, Package } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { AccountForm } from "./account-form";
import { PasswordChangeForm } from "@/components/shared/password-change-form";
import { EmailChangeForm } from "@/components/shared/email-change-form";

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
      "full_name, full_name_ar, phone, country, timezone, lang, date_of_birth, parent_name, parent_phone, parent_email",
    )
    .eq("id", user.id)
    .single<ProfileRow>();
  if (!profile) redirect("/student/dashboard");

  return (
    <main dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-2">
        <Settings size={24} className="text-gold" aria-hidden="true" />
        <h1 className="text-2xl font-bold">{t("إعداداتي", "My Settings")}</h1>
      </div>
      <p className="mb-8 text-sm text-muted">
        {t(
          "تحكم في بياناتك الشخصية، بيانات ولي الأمر، وكلمة المرور.",
          "Manage your personal info, guardian contact, and password.",
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
          <Link href="/student/packages" className="flex min-h-[44px] items-center gap-3 rounded-xl border border-[var(--surface-border)] p-3 transition-colors hover:border-gold/30 hover:bg-foreground/5">
            <Package size={16} className="shrink-0 text-gold" aria-hidden="true" />
            <span className="text-sm">{t("الباقات", "Packages")}</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
