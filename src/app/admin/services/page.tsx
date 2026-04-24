import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { ServiceRow } from "./service-row";

export const metadata: Metadata = { title: "إدارة الخدمات" };

export default async function AdminServicesPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

  // Admin can see ALL services (active + inactive) — use service role or bypass RLS
  const { data } = await supabase
    .from("services")
    .select("id, title, title_ar, description, display_order, is_active, created_at")
    .order("display_order", { ascending: true })
    .returns<{ id: string; title: string; title_ar: string | null; description: string; display_order: number; is_active: boolean; created_at: string }[]>();

  const services = data ?? [];

  return (
    <div dir={dir} className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Settings size={24} className="text-gold" /> {t("إدارة الخدمات", "Manage Services")}</h1>
        <Link href="/admin/services/new" className="flex items-center gap-2 glass-gold glass-pill px-5 py-2.5 text-sm font-semibold">
          <Plus size={16} /> {t("إضافة خدمة", "Add Service")}
        </Link>
      </div>

      <div className="mb-4 text-sm text-muted">{services.length} {t("خدمة", "services")}</div>

      {services.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center">
          <Settings size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">{t("لا توجد خدمات — أضف خدمة جديدة", "No services — add a new one")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map(s => (
            <ServiceRow key={s.id} service={s} />
          ))}
        </div>
      )}
    </div>
  );
}
