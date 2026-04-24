import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PackageForm } from "../package-form";

export const metadata: Metadata = { title: "إضافة باقة جديدة" };

export default async function NewPackagePage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin/packages" className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover">
        <ArrowRight size={14} />
        {t("العودة للباقات", "Back to Packages")}
      </Link>
      <h1 className="mb-6 text-xl font-bold">{t("إضافة باقة جديدة", "Add New Package")}</h1>
      <PackageForm />
    </div>
  );
}
