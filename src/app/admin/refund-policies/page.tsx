import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Shield, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PolicyToggle } from "./policy-toggle";

export const metadata: Metadata = { title: "سياسات الاسترداد" };

interface PolicyRow { id: string; hours_before_min: number; hours_before_max: number | null; refund_percentage: number; description: string | null; is_active: boolean; sort_order: number; }

export default async function AdminRefundPoliciesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.from("refund_policies").select("id, hours_before_min, hours_before_max, refund_percentage, description, is_active, sort_order")
    .order("sort_order", { ascending: true }).returns<PolicyRow[]>();
  const policies = data ?? [];

  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><Shield size={24} className="text-gold" /> سياسات الاسترداد</h1>
      {policies.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center"><Inbox size={32} className="mx-auto mb-3 text-muted" /><p className="text-muted">لا توجد سياسات</p></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-card-border bg-card">
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الفترة</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">نسبة الاسترداد</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الوصف</th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-muted">الحالة</th>
            </tr></thead>
            <tbody>
              {policies.map(p => (
                <tr key={p.id} className="border-b border-card-border last:border-b-0">
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
