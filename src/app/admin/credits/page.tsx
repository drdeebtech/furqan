import type { Metadata } from "next";
import { Package, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { GrantCreditForm } from "./grant-form";

export const metadata: Metadata = {
  title: "منح رصيد · Manual Credit Grant",
};

interface ActivePackageRow {
  id: string;
  student_id: string;
  sessions_total: number;
  sessions_used: number;
  expires_at: string | null;
  status: string;
  packages: { name: string; name_ar: string } | null;
  profiles: { full_name: string; email: string } | null;
}

export default async function AdminCreditsPage() {
  const { t, dir, lang } = await getT();
  const supabase = await createClient();

  // Active packages with low balance (≤2 remaining OR expiring within 7 days)
  const { data: pkgs } = await supabase
    .from("student_packages")
    .select("id, student_id, sessions_total, sessions_used, expires_at, status, packages(name, name_ar), profiles!student_packages_student_id_fkey(full_name, email)")
    .eq("status", "active")
    .order("expires_at", { ascending: true, nullsFirst: false })
    .returns<ActivePackageRow[]>();

  const now = Date.now();
  const lowBalance = (pkgs ?? []).filter((p) => {
    const remaining = p.sessions_total - p.sessions_used;
    if (remaining <= 2) return true;
    if (p.expires_at && new Date(p.expires_at).getTime() - now <= 7 * 24 * 60 * 60 * 1000) return true;
    return false;
  });

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <Package size={24} className="text-gold" />
          <h1 className="text-xl font-bold">{t("منح رصيد يدوي", "Manual Credit Grant")}</h1>
        </div>
        <p className="mt-2 text-sm text-muted">
          {t(
            "امنح الطالب جلسات إضافية على باقته النشطة. يُسجل كل منح في سجل المراجعة.",
            "Grant additional sessions on the student's active package. Every grant is recorded in the audit log.",
          )}
        </p>
      </header>

      <GrantCreditForm />

      <section className="mt-10">
        <div className="mb-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-warning" />
          <h2 className="text-lg font-bold">{t("باقات منخفضة الرصيد أو قريبة الانتهاء", "Low-Balance or Expiring Packages")}</h2>
          <span className="text-xs text-muted">({lowBalance.length})</span>
        </div>

        {lowBalance.length === 0 ? (
          <p className="rounded-xl border border-surface-border/60 bg-surface/40 p-6 text-center text-sm text-muted">
            {t("لا توجد باقات بحاجة إلى الانتباه الآن.", "No packages need attention right now.")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-surface-border/60">
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="p-3 text-start">{t("الطالب", "Student")}</th>
                  <th className="p-3 text-start">{t("الباقة", "Package")}</th>
                  <th className="p-3 text-start">{t("المتبقي", "Remaining")}</th>
                  <th className="p-3 text-start">{t("تنتهي", "Expires")}</th>
                  <th className="p-3 text-start"></th>
                </tr>
              </thead>
              <tbody>
                {lowBalance.map((p) => {
                  const remaining = p.sessions_total - p.sessions_used;
                  const expiryDays =
                    p.expires_at != null
                      ? Math.ceil((new Date(p.expires_at).getTime() - now) / (24 * 60 * 60 * 1000))
                      : null;
                  return (
                    <tr key={p.id} className="border-t border-surface-border/60">
                      <td className="p-3">
                        <p className="font-medium">{p.profiles?.full_name ?? "—"}</p>
                        <p className="text-xs text-muted">{p.profiles?.email ?? ""}</p>
                      </td>
                      <td className="p-3">{(lang === "ar" ? p.packages?.name_ar : p.packages?.name) ?? p.packages?.name ?? "—"}</td>
                      <td className="p-3">
                        <span className={remaining === 0 ? "text-red-400" : remaining <= 2 ? "text-warning" : "text-foreground"}>
                          {remaining} / {p.sessions_total}
                        </span>
                      </td>
                      <td className="p-3 text-xs">
                        {p.expires_at ? (
                          <span className={expiryDays !== null && expiryDays <= 7 ? "text-warning" : "text-muted"}>
                            {expiryDays !== null && expiryDays <= 0
                              ? t("منتهية", "Expired")
                              : t(`خلال ${expiryDays} يوم`, `in ${expiryDays} days`)}
                          </span>
                        ) : (
                          <span className="text-muted">{t("بدون انتهاء", "No expiry")}</span>
                        )}
                      </td>
                      <td className="p-3">
                        <a
                          href={`#grant-${p.student_id}`}
                          className="text-xs font-medium text-gold hover:text-gold-light"
                        >
                          {t("منح رصيد ←", "Grant credit →")}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
