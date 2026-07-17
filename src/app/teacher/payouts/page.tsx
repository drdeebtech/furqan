// Spec 040 Phase 2 — the teacher payouts page (FR-004 status card, FR-028
// agreement acceptance, FR-024 earnings ledger). Server component: session +
// teacher gate first, then the service-role read models (the layout's
// requireRole("teacher") already gates the /teacher prefix; this page
// re-derives identity per CLAUDE.md §3 anyway).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import { getT } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";
import { logError } from "@/lib/logger";
import {
  deriveAccountStatus,
  type ConnectAccountStatus,
} from "@/lib/domains/connect/connect-accounts";
import { createConnectAccountsStore } from "@/lib/domains/connect/connect-accounts-store";
import { AgreementCard } from "./agreement-card";
import { PayoutStatusCard } from "./payout-status-card";
import { EarningsTable, type LedgerEntry } from "./earnings-table";

export const metadata: Metadata = { title: "المدفوعات" };
export const dynamic = "force-dynamic";

interface PayoutMethodRow {
  payout_method: string;
}

export default async function TeacherPayoutsPage() {
  const { t, lang } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS-scoped teacher check (own row): no teacher profile → not this page.
  const { data: teacherRow, error: teacherError } = await supabase
    .from("teacher_profiles")
    .select("payout_method")
    .eq("teacher_id", user.id)
    .maybeSingle<PayoutMethodRow>();
  if (teacherError) {
    logError("teacher-payouts page: teacher_profiles read failed", teacherError, {
      tag: "connect",
      metadata: { route: "/teacher/payouts", widget: "page-gate", userId: user.id },
    });
    throw new Error("payouts page: teacher check failed");
  }
  if (!teacherRow) redirect("/teacher/dashboard");
  const payoutMethod = teacherRow.payout_method === "manual" ? "manual" : "stripe_connect";

  // Service-role read models — AFTER the session/teacher gate.
  const admin = createAdminClient();
  // FR-021 dormancy: an unarmed (blank) connect_cutover_date keeps the whole
  // Connect rail dormant — the card shows "coming soon" instead of routing a
  // real teacher into a test-mode Stripe flow. Fail-closed on a settings
  // outage: getSettings' catch yields {}, which reads as not-live.
  const settings = await getSettings().catch(() => ({}) as Record<string, string>);
  const connectLive = (settings["connect_cutover_date"] ?? "").trim() !== "";
  const [overviewResult, accountRow] = await Promise.all([
    callRpc(admin, "connect_teacher_payout_overview", { p_teacher_id: user.id }),
    createConnectAccountsStore()
      .getByTeacherId(user.id)
      .catch((error) => {
        // Loud but non-fatal: the ledger/agreement still render; the card
        // falls back to "none" (worst case: teacher re-opens onboarding,
        // which is idempotent server-side).
        logError("teacher-payouts page: account mirror read failed", error, {
          tag: "connect",
          metadata: { route: "/teacher/payouts", widget: "status-card", userId: user.id },
        });
        return null;
      }),
  ]);

  if (overviewResult.error || !overviewResult.data?.[0]) {
    logError(
      "teacher-payouts page: overview rpc failed",
      overviewResult.error ?? new Error("empty overview"),
      { tag: "connect", metadata: { route: "/teacher/payouts", widget: "overview", userId: user.id } },
    );
    throw new Error("payouts page: overview read failed");
  }
  const overview = overviewResult.data[0];
  const entries = (Array.isArray(overview.entries) ? overview.entries : []) as unknown as LedgerEntry[];
  const status: ConnectAccountStatus = deriveAccountStatus(accountRow);

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-bold">{t("المدفوعات والأرباح", "Payouts & earnings")}</h1>
        <p className="mt-1 text-sm text-muted">
          {t(
            "حالة حسابك، اتفاقية المعلّم، وسجل أرباحك — في مكان واحد.",
            "Your payout status, the Teacher Agreement, and your earnings ledger — in one place.",
          )}
        </p>
      </header>

      {!overview.accepted_current && overview.current_version ? (
        <AgreementCard version={overview.current_version} lang={lang} />
      ) : null}

      <PayoutStatusCard
        status={status}
        payoutMethod={payoutMethod}
        connectLive={connectLive}
        lang={lang}
      />

      <EarningsTable
        entries={entries}
        outstandingDebtCents={overview.outstanding_debt_cents}
        lang={lang}
      />
    </div>
  );
}
