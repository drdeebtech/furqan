import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { Package } from "@/types/database";
import { PackageForm } from "../../package-form";

export const metadata: Metadata = { title: "تعديل الباقة" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditPackagePage({ params }: Props) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

  const { data: pkg } = await supabase
    .from("packages")
    .select("*")
    .eq("id", id)
    .returns<Package[]>()
    .single();

  if (!pkg) redirect("/admin/packages");

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin/packages" className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover">
        <ArrowRight size={14} />
        {t("العودة للباقات", "Back to Packages")}
      </Link>
      <h1 className="mb-6 text-xl font-bold">{t("تعديل الباقة", "Edit Package")}: {(lang === "ar" ? pkg.name_ar : pkg.name) ?? pkg.name}</h1>
      <PackageForm pkg={pkg} />
    </div>
  );
}
