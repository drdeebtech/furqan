import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shield, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { PolicyToggle } from "./policy-toggle";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "سياسات الاسترداد" };

interface PolicyRow { id: string; hours_before_min: number; hours_before_max: number | null; refund_percentage: number; description: string | null; is_active: boolean; sort_order: number; }

export default async function AdminRefundPoliciesPage() {
  const { t, dir } = await getT();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("refund_policies").select("id, hours_before_min, hours_before_max, refund_percentage, description, is_active, sort_order")
    .order("sort_order", { ascending: true }).returns<PolicyRow[]>();
  const policies = data ?? [];

  return (
    <div dir={dir} className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Shield size={24} className="text-gold" /> {t("سياسات الاسترداد", "Refund Policies")}</h1>
      {policies.length === 0 ? (
        <EmptyState
          variant="glass-card"
          icon={<Inbox size={32} className="text-muted" />}
          message={t("لا توجد سياسات", "No policies yet")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead><tr className="glass-thead">
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الفترة", "Window")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("نسبة الاسترداد", "Refund %")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الوصف", "Description")}</th>
              <th scope="col" className="px-4 py-3 text-start font-medium text-muted">{t("الحالة", "Status")}</th>
            </tr></thead>
            <tbody>
              {policies.map(p => (
                <tr key={p.id} className="border-b border-white/10 last:border-b-0">
                  <td className="px-4 py-3 font-medium">{p.hours_before_min}h — {p.hours_before_max ? `${p.hours_before_max}h` : "∞"}</td>
                  <td className="px-4 py-3 text-gold font-bold">{p.refund_percentage}%</td>
                  <td className="px-4 py-3 text-muted">{p.description ?? "—"}</td>
                  <td className="px-4 py-3"><PolicyToggle policyId={p.id} isActive={p.is_active} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
