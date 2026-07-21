import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import { logError } from "@/lib/logger";
import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/shared/page-header";
import {
  ExportButton,
  LiftHoldButton,
  MethodSwitch,
  PlaceHoldForm,
  RequeueButton,
  SettleForm,
  SweepButton,
} from "./payouts-controls";

export const metadata: Metadata = { title: "مدفوعات المعلمين" };
export const dynamic = "force-dynamic";

// Shape of connect_admin_payouts_overview() (spec 040 Phase 4). Parsed from
// jsonb — validated structurally by the casts below; the RPC is the single
// producer so drift is caught by the SQL walk, not runtime zod.
interface ActiveHold {
  id: string;
  source: "admin" | "dispute";
  reason: string;
  created_at: string;
}
interface TeacherRow {
  teacher_id: string;
  full_name: string;
  payout_method: "stripe_connect" | "manual";
  payouts_enabled: boolean;
  details_submitted: boolean;
  stripe_account_id: string | null;
  pending_cents: number;
  processing_cents: number;
  held_cents: number;
  manual_due_cents: number;
  transferred_cents: number;
  manual_paid_cents: number;
  outstanding_debt_cents: number;
  failed_transfers: number;
  last_transfer_error: string | null;
  active_holds: ActiveHold[];
}
interface ManualDueRow {
  entry_id: string;
  teacher_id: string;
  full_name: string;
  amount_cents: number;
  /** FR-027a: the payable net (remaining value minus FIFO debt share). */
  net_due_cents: number;
  recovered_cents: number;
  session_delivery_id: string | null;
  delivered_at: string | null;
  created_at: string;
}
interface FailedEntryRow {
  entry_id: string;
  teacher_id: string;
  full_name: string;
  amount_cents: number;
  attempt_count: number;
  last_error_detail: string | null;
  updated_at: string;
}
interface Overview {
  cutover_date: string;
  teachers: TeacherRow[];
  manual_due: ManualDueRow[];
  failed_entries: FailedEntryRow[];
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const utcDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "UTC" }) : "—";

export default async function AdminPayoutsPage() {
  const { t, dir } = await getT();
  const { id: adminId } = await requireAdmin();

  // Never render a failed financial read as an EMPTY queue (CodeRabbit
  // major): returned errors, null data AND rejected loads all land on the
  // same explicit unavailable state with no controls.
  let snapshot: unknown = null;
  let loadFailed = false;
  try {
    const { data, error } = await callRpc(createAdminClient(), "connect_admin_payouts_overview", {});
    if (error || data == null) throw error ?? new Error("null overview");
    snapshot = data;
  } catch (e) {
    loadFailed = true;
    logError("admin payouts page: overview failed", e, {
      tag: "admin-payouts", route: "/admin/payouts", widget: "overview", userId: adminId,
    });
  }
  if (loadFailed) {
    return (
      <div dir={dir} className="space-y-6">
        <PageHeader
          title={t("مدفوعات المعلمين (Stripe Connect)", "Teacher payouts (Stripe Connect)")}
          icon={<Wallet size={24} className="text-gold" />}
        />
        <div className="glass-card rounded-xl p-4 text-sm text-error" role="alert">
          {t(
            "تعذّر تحميل بيانات المدفوعات. لا يعني هذا أن القائمة فارغة — أعد المحاولة أو راجع السجلات.",
            "Could not load payout data. This does NOT mean the queue is empty — retry or check the logs.",
          )}
        </div>
      </div>
    );
  }
  const overview = snapshot as Overview;
  const live = overview.cutover_date.trim() !== "";

  return (
    <div dir={dir} className="space-y-6">
      <PageHeader
        title={t("مدفوعات المعلمين (Stripe Connect)", "Teacher payouts (Stripe Connect)")}
        icon={<Wallet size={24} className="text-gold" />}
      />

      {/* FR-021/FR-022: dormancy + legacy partition labeling */}
      <div className="glass-card rounded-xl p-4 text-sm">
        {live ? (
          <p>
            {t(
              `تاريخ التحويل: ${overview.cutover_date} — الجلسات المُقدَّمة قبله تُدفع عبر الرواتب الشهرية القديمة (شهور قديمة)، وبعده عبر Stripe Connect.`,
              `Cutover: ${overview.cutover_date} — deliveries before this date are paid by the LEGACY monthly payroll (legacy months); on/after it, via Stripe Connect.`,
            )}
          </p>
        ) : (
          <p className="text-warning">
            {t(
              "مسار Stripe Connect خامل: لم يُحدَّد تاريخ التحويل بعد؛ كل الجلسات تُدفع عبر الرواتب الشهرية القديمة.",
              "Stripe Connect path is DORMANT: no cutover date set — all deliveries are paid by the legacy monthly payroll.",
            )}
          </p>
        )}
        <div className="mt-3">
          <SweepButton
            label={t("تشغيل المسح الآن", "Run sweep now")}
            confirmText={t(
              "تشغيل مسح التحويلات الآن؟ (آمن للتكرار)",
              "Run the transfer sweep now? (idempotent — safe to repeat)",
            )}
          />
        </div>
      </div>

      {/* Per-teacher state table (FR-023 / US5) */}
      <section aria-labelledby="teachers-h" className="glass-card rounded-xl p-4">
        <h2 id="teachers-h" className="mb-3 text-lg font-semibold">
          {t("حالة المعلمين", "Teacher states")}
        </h2>
        {overview.teachers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("لا توجد بيانات مدفوعات بعد.", "No payout data yet.")}
          </p>
        ) : (
          <div tabIndex={0} role="region" aria-label={t("جدول المعلمين", "Teachers table")}
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2">
            <table className="w-full min-w-[1100px] text-start text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground">
                  <th scope="col" className="p-2 text-start">{t("المعلم", "Teacher")}</th>
                  <th scope="col" className="p-2 text-start">{t("المسار", "Rail")}</th>
                  <th scope="col" className="p-2 text-start">{t("حساب Stripe", "Stripe account")}</th>
                  <th scope="col" className="p-2 text-start">{t("قيد الانتظار", "Pending")}</th>
                  <th scope="col" className="p-2 text-start">{t("محجوز", "Held")}</th>
                  <th scope="col" className="p-2 text-start">{t("يدوي مستحق", "Manual due")}</th>
                  <th scope="col" className="p-2 text-start">{t("محوَّل", "Transferred")}</th>
                  <th scope="col" className="p-2 text-start">{t("دين مستحق", "Debt")}</th>
                  <th scope="col" className="p-2 text-start">{t("تحويلات فاشلة", "Failed")}</th>
                  <th scope="col" className="p-2 text-start">{t("إيقافات", "Holds")}</th>
                  <th scope="col" className="p-2 text-start">{t("إجراءات", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.teachers.map((tr) => (
                  <tr key={tr.teacher_id} className="border-b border-white/5 align-top">
                    <td className="p-2">{tr.full_name || tr.teacher_id.slice(0, 8)}</td>
                    <td className="p-2">
                      {tr.payout_method === "manual" ? t("يدوي", "manual") : "Stripe"}
                    </td>
                    <td className="p-2" dir="ltr">
                      {tr.stripe_account_id
                        ? tr.payouts_enabled
                          ? t("مفعّل", "payouts enabled")
                          : tr.details_submitted
                            ? t("قيد التحقق", "pending verification")
                            : t("غير مكتمل", "incomplete")
                        : "—"}
                    </td>
                    <td className="p-2" dir="ltr">{usd(tr.pending_cents + tr.processing_cents)}</td>
                    <td className="p-2" dir="ltr">{usd(tr.held_cents)}</td>
                    <td className="p-2" dir="ltr">{usd(tr.manual_due_cents)}</td>
                    <td className="p-2" dir="ltr">{usd(tr.transferred_cents + tr.manual_paid_cents)}</td>
                    <td className={`p-2 ${tr.outstanding_debt_cents > 0 ? "font-semibold text-error" : ""}`} dir="ltr">
                      {tr.outstanding_debt_cents > 0 ? `−${usd(tr.outstanding_debt_cents)}` : "$0.00"}
                    </td>
                    <td className="p-2" dir="ltr">
                      {tr.failed_transfers > 0 ? (
                        <span className="text-error" title={tr.last_transfer_error ?? undefined}>
                          {tr.failed_transfers}
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>
                    <td className="p-2">
                      {tr.active_holds.length === 0 ? (
                        "—"
                      ) : (
                        <ul className="space-y-1">
                          {tr.active_holds.map((h) => (
                            <li key={h.id} className="flex items-center gap-1 text-xs">
                              <span className={h.source === "dispute" ? "text-warning" : ""}>
                                {h.source}: {h.reason}
                              </span>
                              <LiftHoldButton holdId={h.id} label={t("رفع", "Lift")} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="space-y-1 p-2">
                      <PlaceHoldForm teacherId={tr.teacher_id} label={t("إيقاف", "Hold")} />
                      <MethodSwitch
                        teacherId={tr.teacher_id}
                        current={tr.payout_method}
                        label={
                          tr.payout_method === "manual"
                            ? t("تحويل إلى Stripe", "Switch to Stripe")
                            : t("تحويل إلى يدوي", "Switch to manual")
                        }
                        confirmText={t(
                          "تغيير مسار الدفع لهذا المعلم؟ (مسجَّل في سجل التدقيق)",
                          "Change this teacher's payout rail? (audit-logged; switching to Stripe re-routes stuck manual entries)",
                        )}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Manual-rail queue (FR-027) */}
      <section aria-labelledby="manual-h" className="glass-card rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="manual-h" className="text-lg font-semibold">
            {t("قائمة الدفع اليدوي", "Manual payout queue")}
          </h2>
          <ExportButton label={t("تصدير CSV", "Export CSV")} />
        </div>
        {overview.manual_due.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("لا توجد مستحقات يدوية.", "Nothing due on the manual rail.")}
          </p>
        ) : (
          <div tabIndex={0} role="region" aria-label={t("جدول المستحقات اليدوية", "Manual due table")}
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground">
                  <th scope="col" className="p-2 text-start">{t("المعلم", "Teacher")}</th>
                  <th scope="col" className="p-2 text-start">{t("الإجمالي", "Gross")}</th>
                  <th scope="col" className="p-2 text-start">{t("الصافي المستحق", "Net due")}</th>
                  <th scope="col" className="p-2 text-start">{t("تاريخ الجلسة", "Delivered")}</th>
                  <th scope="col" className="p-2 text-start">{t("تسوية (مرجع إلزامي)", "Settle (reference required)")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.manual_due.map((row) => (
                  <tr key={row.entry_id} className="border-b border-white/5">
                    <td className="p-2">{row.full_name || row.teacher_id.slice(0, 8)}</td>
                    <td className="p-2" dir="ltr">{usd(row.amount_cents)}</td>
                    {/* FR-027a: the NET is what the admin pays; a difference from
                        gross means debt was (or will be) netted against it. */}
                    <td className="p-2 font-semibold" dir="ltr">
                      {usd(row.net_due_cents)}
                      {row.net_due_cents !== row.amount_cents ? (
                        <span className="ms-1 text-xs font-normal text-warning">
                          {t("(بعد خصم الدين)", "(after debt)")}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-2" dir="ltr">{utcDate(row.delivered_at)}</td>
                    <td className="p-2">
                      <SettleForm
                        entryId={row.entry_id}
                        netDueCents={row.net_due_cents}
                        label={t("تسوية", "Settle")}
                        closeLabel={t("إغلاق (مستهلك بالدين)", "Close (consumed by debt)")}
                        confirmText={t(
                          `تأكيد تسوية ${usd(row.net_due_cents)} يدويًا؟ (يُسجَّل في سجل التدقيق)`,
                          `Confirm settling ${usd(row.net_due_cents)} off-Stripe? (audit-logged, irreversible)`,
                        )}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Terminal-failed transfers (FR-011): retries exhausted, parked loud. */}
      <section aria-labelledby="failed-h" className="glass-card rounded-xl p-4">
        <h2 id="failed-h" className="mb-3 text-lg font-semibold">
          {t("تحويلات فاشلة (تحتاج تدخّل)", "Failed transfers (need attention)")}
        </h2>
        {overview.failed_entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("لا توجد تحويلات فاشلة.", "No terminally-failed transfers.")}
          </p>
        ) : (
          <div tabIndex={0} role="region" aria-label={t("جدول التحويلات الفاشلة", "Failed transfers table")}
            className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground">
                  <th scope="col" className="p-2 text-start">{t("المعلم", "Teacher")}</th>
                  <th scope="col" className="p-2 text-start">{t("المبلغ", "Amount")}</th>
                  <th scope="col" className="p-2 text-start">{t("المحاولات", "Attempts")}</th>
                  <th scope="col" className="p-2 text-start">{t("آخر خطأ", "Last error")}</th>
                  <th scope="col" className="p-2 text-start">{t("إجراء", "Action")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.failed_entries.map((row) => (
                  <tr key={row.entry_id} className="border-b border-white/5">
                    <td className="p-2">{row.full_name || row.teacher_id.slice(0, 8)}</td>
                    <td className="p-2" dir="ltr">{usd(row.amount_cents)}</td>
                    <td className="p-2" dir="ltr">{row.attempt_count}</td>
                    {/* Full text rendered (wrapped) — a hover-only tooltip would
                        hide the operational detail from touch/keyboard users. */}
                    <td className="max-w-80 whitespace-pre-wrap break-words p-2 text-xs text-error" dir="ltr">
                      {row.last_error_detail ?? "—"}
                    </td>
                    <td className="p-2">
                      <RequeueButton
                        entryId={row.entry_id}
                        label={t("إعادة للطابور", "Requeue")}
                        confirmText={t(
                          "إعادة هذا التحويل الفاشل إلى الطابور؟ (سيُعاد تنفيذه في المسح التالي)",
                          "Requeue this failed transfer? The next sweep retries it (idempotent — Stripe replays the same transfer).",
                        )}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
