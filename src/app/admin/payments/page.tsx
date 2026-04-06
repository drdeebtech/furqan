import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DollarSign, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "المالية" };

interface PaymentRow { id: string; student_id: string; amount_usd: number; status: string; stripe_payment_intent: string; paid_at: string | null; created_at: string; }
interface InvoiceRow { id: string; invoice_number: string; student_name_snapshot: string; amount_usd: number; currency: string; created_at: string; }

export default async function AdminPaymentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [paymentsRes, invoicesRes] = await Promise.all([
    supabase.from("payments").select("id, student_id, amount_usd, status, stripe_payment_intent, paid_at, created_at")
      .order("created_at", { ascending: false }).limit(100).returns<PaymentRow[]>(),
    supabase.from("invoices").select("id, invoice_number, student_name_snapshot, amount_usd, currency, created_at")
      .order("created_at", { ascending: false }).limit(50).returns<InvoiceRow[]>(),
  ]);

  const payments = paymentsRes.data ?? [];
  const invoices = invoicesRes.data ?? [];

  const totalRevenue = payments.filter(p => p.status === "succeeded").reduce((s, p) => s + Number(p.amount_usd), 0);
  const pendingCount = payments.filter(p => p.status === "pending").length;
  const refundedAmount = payments.filter(p => p.status === "refunded").reduce((s, p) => s + Number(p.amount_usd), 0);

  let nameMap: Record<string, string> = {};
  if (payments.length > 0) {
    const ids = [...new Set(payments.map(p => p.student_id))];
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids).returns<{ id: string; full_name: string | null }[]>();
    if (profiles) nameMap = Object.fromEntries(profiles.map(p => [p.id, p.full_name ?? "—"]));
  }

  const STATUS_COLORS: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    succeeded: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    failed: "bg-red-500/10 text-red-400 border-red-500/30",
    refunded: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  };

  return (
    <div dir="rtl" className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-bold"><DollarSign size={24} className="text-gold" /> المالية</h1>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-card-border bg-card p-4"><p className="text-sm text-muted">إجمالي الإيرادات</p><p className="mt-1 text-2xl font-bold text-gold">${totalRevenue.toFixed(2)}</p></div>
        <div className="rounded-xl border border-card-border bg-card p-4"><p className="text-sm text-muted">معلقة</p><p className="mt-1 text-2xl font-bold text-gold">{pendingCount}</p></div>
        <div className="rounded-xl border border-card-border bg-card p-4"><p className="text-sm text-muted">مسترجعة</p><p className="mt-1 text-2xl font-bold text-gold">${refundedAmount.toFixed(2)}</p></div>
      </div>

      {/* Payments */}
      <h2 className="mb-4 text-lg font-bold">المدفوعات</h2>
      {payments.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center"><Inbox size={28} className="mx-auto mb-2 text-muted" /><p className="text-sm text-muted">لا توجد مدفوعات</p></div>
      ) : (
        <div className="mb-8 overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-card-border bg-card">
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الطالب</th>
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">المبلغ</th>
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الحالة</th>
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">Stripe</th>
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">التاريخ</th>
            </tr></thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-card-border last:border-b-0">
                  <td className="px-3 py-3">{nameMap[p.student_id] ?? "—"}</td>
                  <td className="px-3 py-3 font-bold text-gold">${Number(p.amount_usd).toFixed(2)}</td>
                  <td className="px-3 py-3"><span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_COLORS[p.status] ?? ""}`}>{p.status}</span></td>
                  <td className="px-3 py-3 text-xs text-muted" dir="ltr">{p.stripe_payment_intent.slice(0, 20)}...</td>
                  <td className="px-3 py-3 text-xs text-muted">{new Date(p.created_at).toLocaleDateString("ar-SA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoices */}
      <h2 className="mb-4 text-lg font-bold">الفواتير</h2>
      {invoices.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-8 text-center"><p className="text-sm text-muted">لا توجد فواتير</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-card-border">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-card-border bg-card">
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">رقم الفاتورة</th>
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">الطالب</th>
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">المبلغ</th>
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">العملة</th>
              <th scope="col" className="px-3 py-3 text-right font-medium text-muted">التاريخ</th>
            </tr></thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-card-border last:border-b-0">
                  <td className="px-3 py-3 font-medium text-gold" dir="ltr">{inv.invoice_number}</td>
                  <td className="px-3 py-3">{inv.student_name_snapshot}</td>
                  <td className="px-3 py-3">${Number(inv.amount_usd).toFixed(2)}</td>
                  <td className="px-3 py-3 text-xs text-muted">{inv.currency}</td>
                  <td className="px-3 py-3 text-xs text-muted">{new Date(inv.created_at).toLocaleDateString("ar-SA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
