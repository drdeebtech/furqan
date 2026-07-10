import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { studentBillingView } from "@/lib/views/student-billing";
import { resolveReceiptUrls } from "@/lib/domains/billing/receipt-urls";
import { DataLoadBanner } from "@/components/shared/data-load-banner";
import { BillingHistory } from "./billing-history";

export const metadata: Metadata = { title: "الفواتير" };

/**
 * `/student/billing` — the student's payment history and receipts.
 *
 * Reads the authoritative list from our own `payments` table (RLS-scoped) via
 * `studentBillingView`, then enriches each row with a live Stripe `receipt_url`.
 * The receipt lookup is best-effort: guarded by `isStripeConfigured()` and, per
 * `resolveReceiptUrls`, isolated per PaymentIntent — it can never block the page.
 */
export default async function StudentBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows, anyFailed } = await studentBillingView(supabase, user.id);

  // Receipt links are non-critical live Stripe metadata — never block the page.
  let receiptUrls: Record<string, string | null> = {};
  if (isStripeConfigured() && rows.length > 0) {
    const resolved = await resolveReceiptUrls(
      getStripe(),
      rows.map((r) => r.stripePaymentIntent),
    );
    receiptUrls = Object.fromEntries(resolved);
  }

  return (
    <>
      <DataLoadBanner failed={anyFailed} />
      <BillingHistory rows={rows} receiptUrls={receiptUrls} />
    </>
  );
}
