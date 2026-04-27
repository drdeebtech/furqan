import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings, User, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { AccountForm } from "./account-form";
import { PasswordChangeForm } from "@/components/shared/password-change-form";

export const metadata: Metadata = { title: "حسابي" };

interface ProfileRow {
  full_name: string | null;
  full_name_ar: string | null;
  phone: string | null;
  country: string | null;
  timezone: string | null;
  lang: string | null;
  date_of_birth: string | null;
}

export default async function AdminAccountPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, full_name_ar, phone, country, timezone, lang, date_of_birth")
    .eq("id", user.id)
    .single<ProfileRow>();
  if (!profile) redirect("/admin/dashboard");

  return (
    <main dir={dir} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-2">
        <Settings size={24} className="text-gold" aria-hidden="true" />
        <h1 className="text-2xl font-bold">{t("حسابي", "My Account")}</h1>
      </div>
      <p className="mb-8 text-sm text-muted">
        {t(
          "بيانات حسابك الشخصية وكلمة المرور. للإعدادات على مستوى المنصة، استخدم ",
          "Your personal account info and password. For platform-level config, use ",
        )}
        <Link href="/admin/settings" className="text-gold hover:text-gold-light">
          {t("إعدادات المنصة", "platform settings")}
        </Link>
        .
      </p>

      <section className="glass-card mb-6 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <User size={18} className="text-gold" aria-hidden="true" />
          {t("الحساب الشخصي", "Personal Info")}
        </h2>
        <AccountForm profile={profile} />
      </section>

      <section className="glass-card p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <KeyRound size={18} className="text-gold" aria-hidden="true" />
          {t("كلمة المرور", "Password")}
        </h2>
        <PasswordChangeForm />
      </section>
    </main>
  );
}
