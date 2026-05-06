import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DollarSign, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buildNameMap } from "@/lib/admin/name-map";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "المالية" };

interface PaymentRow { id: string; student_id: string; amount_usd: number; status: string; stripe_payment_intent: string; paid_at: string | null; created_at: string; }
interface InvoiceRow { id: string; invoice_number: string; student_name_snapshot: string; amount_usd: number; currency: string; created_at: string; }

export default async function AdminPaymentsPage() {
  const { t, dir, lang } = await getT();
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

  const nameMap = await buildNameMap(supabase, [...new Set(payments.map(p => p.student_id))]);

  const STATUS_COLORS: Record<string, string> = {
    pending: "bg-warning/10 text-warning border-warning/30",
    succeeded: "bg-success/10 text-success border-success/30",
    failed: "bg-error/10 text-red-400 border-error/30",
    refunded: "bg-gold/10 text-gold border-gold/30",
  };

  return (
    <div dir={dir} className="mx-auto max-w-6xl px-4 py-8">
      <PageHeader icon={<DollarSign size={24} className="text-gold" />} title={t("المالية", "Payments")} />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="glass-card rounded-xl p-4"><p className="text-sm text-muted">{t("إجمالي الإيرادات", "Total Revenue")}</p><p className="mt-1 text-2xl font-bold text-gold">${totalRevenue.toFixed(2)}</p></div>
        <div className="glass-card rounded-xl p-4"><p className="text-sm text-muted">{t("معلقة", "Pending")}</p><p className="mt-1 text-2xl font-bold text-gold">{pendingCount}</p></div>
        <div className="glass-card rounded-xl p-4"><p className="text-sm text-muted">{t("مسترجعة", "Refunded")}</p><p className="mt-1 text-2xl font-bold text-gold">${refundedAmount.toFixed(2)}</p></div>
      </div>

      {/* Payments */}
      <h2 className="mb-4 text-lg font-bold">{t("المدفوعات", "Payments")}</h2>
      {payments.length === 0 ? (
        <div className="glass-card rounded-xl p-8 text-center"><Inbox size={28} className="mx-auto mb-2 text-muted" /><p className="text-sm text-muted">{t("لا توجد مدفوعات", "No payments yet")}</p></div>
      ) : (
        <div className="mb-8 overflow-x-auto rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead><tr className="glass-thead">
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الطالب", "Student")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("المبلغ", "Amount")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الحالة", "Status")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">Stripe</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("التاريخ", "Date")}</th>
            </tr></thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3">{nameMap[p.student_id] ?? "—"}</td>
                  <td className="px-3 py-3 font-bold text-gold">${Number(p.amount_usd).toFixed(2)}</td>
                  <td className="px-3 py-3"><span className={`glass-badge ${STATUS_COLORS[p.status] ?? ""}`}>{p.status}</span></td>
                  <td className="px-3 py-3 text-xs text-muted" dir="ltr">{p.stripe_payment_intent.slice(0, 20)}...</td>
                  <td className="px-3 py-3 text-xs text-muted">{new Date(p.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoices */}
      <h2 className="mb-4 text-lg font-bold">{t("الفواتير", "Invoices")}</h2>
      {invoices.length === 0 ? (
        <div className="glass-card rounded-xl p-8 text-center"><p className="text-sm text-muted">{t("لا توجد فواتير", "No invoices yet")}</p></div>
      ) : (
        <div className="overflow-x-auto rounded-xl glass-card">
          <table className="w-full text-sm">
            <thead><tr className="glass-thead">
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("رقم الفاتورة", "Invoice #")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("الطالب", "Student")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("المبلغ", "Amount")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("العملة", "Currency")}</th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted">{t("التاريخ", "Date")}</th>
            </tr></thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id} className="border-b border-white/10 last:border-b-0">
                  <td className="px-3 py-3 font-medium text-gold" dir="ltr">{inv.invoice_number}</td>
                  <td className="px-3 py-3">{inv.student_name_snapshot}</td>
                  <td className="px-3 py-3">${Number(inv.amount_usd).toFixed(2)}</td>
                  <td className="px-3 py-3 text-xs text-muted">{inv.currency}</td>
                  <td className="px-3 py-3 text-xs text-muted">{new Date(inv.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
