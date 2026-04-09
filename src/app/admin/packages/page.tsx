import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Package, Plus, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Package as PackageType } from "@/types/database";
import { PACKAGE_TYPE_AR } from "@/lib/constants";
import { PackageActions } from "./package-actions";

export const metadata: Metadata = { title: "إدارة الباقات" };

export default async function AdminPackagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") redirect("/login");

  const { data: packages } = await supabase
    .from("packages")
    .select("*")
    .order("display_order", { ascending: true })
    .returns<PackageType[]>();

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package size={24} className="text-gold" />
          <h1 className="text-xl font-bold">إدارة الباقات</h1>
          <span className="text-sm text-muted">Packages</span>
        </div>
        <Link
          href="/admin/packages/new"
          className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors hover:bg-primary-hover"
        >
          <Plus size={16} />
          إضافة باقة
        </Link>
      </div>

      {!packages || packages.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Package size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">لا توجد باقات بعد</p>
        </div>
      ) : (
        <div className="space-y-3">
          {packages.map(pkg => (
            <div key={pkg.id} className={`glass-card flex flex-wrap items-center justify-between gap-4 p-4 ${!pkg.is_active ? "opacity-60" : ""}`}>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {pkg.is_featured && <Star size={14} className="text-gold" />}
                  <span className="font-semibold">{pkg.name_ar ?? pkg.name}</span>
                  <span className="text-xs text-muted">({pkg.name})</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-muted">
                    {PACKAGE_TYPE_AR[pkg.package_type as keyof typeof PACKAGE_TYPE_AR] ?? pkg.package_type}
                  </span>
                </div>
                <div className="flex gap-3 text-xs text-muted">
                  <span>{pkg.session_count} جلسات</span>
                  <span>·</span>
                  <span>{pkg.duration_min} دقيقة</span>
                  <span>·</span>
                  <span className="font-medium text-gold">${pkg.price_usd}</span>
                  {pkg.price_sar && <span>/ ر.س{pkg.price_sar}</span>}
                </div>
              </div>
              <PackageActions packageId={pkg.id} isActive={pkg.is_active} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
