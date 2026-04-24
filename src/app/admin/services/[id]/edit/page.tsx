import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { ServiceForm } from "../../service-form";

export const metadata: Metadata = { title: "تعديل الخدمة" };

interface Props { params: Promise<{ id: string }> }

export default async function EditServicePage({ params }: Props) {
  const { id } = await params;
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  const { data: service } = await supabase
    .from("services")
    .select("id, title, title_ar, description, description_ar, features, features_ar, icon, image_url, display_order, is_active")
    .eq("id", id)
    .single<{
      id: string; title: string; title_ar: string | null;
      description: string; description_ar: string | null;
      features: string[]; features_ar: string[];
      icon: string | null; image_url: string | null;
      display_order: number; is_active: boolean;
    }>();

  if (!service) redirect("/admin/services");

  return (
    <div dir={dir} className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin/services" className="mb-6 inline-flex items-center gap-1 text-sm text-gold hover:text-gold-hover">
        <ArrowRight size={14} /> {t("العودة للخدمات", "Back to Services")}
      </Link>
      <h1 className="mb-6 text-2xl font-bold">{t("تعديل", "Edit")}: {(lang === "ar" ? service.title_ar : service.title) ?? service.title}</h1>
      <div className="glass-card rounded-xl p-6">
        <ServiceForm service={service} />
      </div>
    </div>
  );
}
