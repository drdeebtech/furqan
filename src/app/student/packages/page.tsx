import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Package, Inbox, ShoppingBag } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { StudentPackage, Package as PackageType } from "@/types/database";
import { STUDENT_PACKAGE_STATUS_STYLE, PACKAGE_TYPE_AR } from "@/lib/constants";

export const metadata: Metadata = { title: "باقاتي" };

export default async function StudentPackagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch student's packages with package details
  const { data: studentPackages } = await supabase
    .from("student_packages")
    .select("*")
    .eq("student_id", user.id)
    .order("purchased_at", { ascending: false })
    .returns<StudentPackage[]>();

  // Fetch package details for each
  const packageIds = [...new Set((studentPackages ?? []).map(sp => sp.package_id))];
  const packageMap: Record<string, PackageType> = {};
  if (packageIds.length > 0) {
    const { data: pkgs } = await supabase
      .from("packages")
      .select("*")
      .in("id", packageIds)
      .returns<PackageType[]>();
    for (const p of pkgs ?? []) {
      packageMap[p.id] = p;
    }
  }

  const active = (studentPackages ?? []).filter(sp => sp.status === "active");
  const inactive = (studentPackages ?? []).filter(sp => sp.status !== "active");

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package size={24} className="text-gold" />
          <h1 className="text-xl font-bold">باقاتي</h1>
          <span className="text-sm text-muted">My Packages</span>
        </div>
        <Link
          href="/packages"
          className="glass-gold glass-pill flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors hover:bg-primary-hover"
        >
          <ShoppingBag size={16} />
          شراء باقة
        </Link>
      </div>

      {(!studentPackages || studentPackages.length === 0) ? (
        <div className="glass-card p-12 text-center">
          <Inbox size={40} className="mx-auto mb-3 text-muted/40" />
          <p className="text-muted">لا توجد باقات بعد</p>
          <p className="mt-1 text-sm text-muted/60">اشترِ باقة لبدء حجز الجلسات</p>
          <Link href="/packages" className="mt-4 inline-block text-sm text-gold hover:text-gold-hover">
            تصفح الباقات ←
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active packages */}
          {active.length > 0 && (
            <div>
              <h2 className="mb-3 font-semibold">باقات نشطة</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {active.map(sp => {
                  const pkg = packageMap[sp.package_id];
                  const remaining = sp.sessions_total - sp.sessions_used;
                  const pct = Math.round((sp.sessions_used / sp.sessions_total) * 100);
                  const style = STUDENT_PACKAGE_STATUS_STYLE[sp.status];

                  return (
                    <div key={sp.id} className="glass-card p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className={`rounded-full border px-2 py-0.5 text-xs ${style.className}`}>
                            {style.label}
                          </span>
                          <h3 className="mt-2 font-semibold">{pkg?.name_ar ?? pkg?.name ?? "باقة"}</h3>
                          {pkg && (
                            <p className="text-xs text-muted">
                              {PACKAGE_TYPE_AR[pkg.package_type as keyof typeof PACKAGE_TYPE_AR] ?? pkg.package_type}
                            </p>
                          )}
                        </div>
                        <div className="text-center">
                          <p className="font-display text-2xl font-bold text-gold">{remaining}</p>
                          <p className="text-xs text-muted">جلسات متبقية</p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-xs text-muted">
                          <span>{sp.sessions_used} مستخدمة</span>
                          <span>{sp.sessions_total} إجمالي</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-gradient-to-l from-gold to-gold/60 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {sp.expires_at && (
                        <p className="mt-2 text-xs text-muted">
                          تنتهي: {new Date(sp.expires_at).toLocaleDateString("ar-SA")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Inactive packages */}
          {inactive.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm text-muted">سجل الباقات</h2>
              <div className="space-y-2">
                {inactive.map(sp => {
                  const pkg = packageMap[sp.package_id];
                  const style = STUDENT_PACKAGE_STATUS_STYLE[sp.status];
                  return (
                    <div key={sp.id} className="glass-card flex items-center justify-between p-3 opacity-60">
                      <div>
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${style.className}`}>{style.label}</span>
                        <span className="mr-2 text-sm">{pkg?.name_ar ?? pkg?.name ?? "باقة"}</span>
                      </div>
                      <span className="text-xs text-muted">
                        {sp.sessions_used}/{sp.sessions_total} جلسات
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
