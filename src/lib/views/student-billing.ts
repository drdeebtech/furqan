import { loadOrFail } from "@/lib/supabase/load-or-fail";
import type { ServerClient } from "@/lib/supabase/types";
import type { PaymentStatus } from "@/types/database";

/**
 * Read seam for `/student/billing`.
 *
 * `payments` is the ONE table every purchase path already writes for all three
 * payment types — subscription (via `grant_subscription_cycle`), single-session
 * (`handlePaymentIntentSucceeded`), and prepaid-hours (`handlePrepaidHoursGrant`)
 * — and the `payments_select` RLS policy (`auth.uid() = student_id`) lets a
 * student read their own rows. So this is a plain RLS `.from()` select: no
 * service-role, no RPC, no schema change.
 *
 * DB-only by design: it returns the authoritative payment list. The page enriches
 * each row with a live Stripe receipt URL via `resolveReceiptUrls` separately, so
 * this view stays unit-testable against a fake client with no Stripe dependency.
 *
 * The `.eq("student_id", ...)` is defense-in-depth (RLS already scopes the read);
 * it also keeps the query intent explicit and lets tests assert the owner filter.
 */

/**
 * Cap the history — a student's payment list is small; this is a safety bound.
 * Exported so the UI can show a "most recent N" note when the cap is hit,
 * rather than silently truncating older receipts.
 */
export const PAYMENTS_HISTORY_LIMIT = 100;

/** Raw selected columns (snake_case, as PostgREST returns them). */
interface PaymentDbRow {
  id: string;
  amount_usd: number;
  amount_local: number | null;
  local_currency: string | null;
  status: PaymentStatus;
  provider: string;
  created_at: string;
  paid_at: string | null;
  stripe_payment_intent: string | null;
  booking_id: string | null;
}

/** Presentation-shaped billing row consumed by `<BillingHistory>`. */
export interface BillingRow {
  id: string;
  amountUsd: number;
  amountLocal: number | null;
  localCurrency: string | null;
  status: PaymentStatus;
  provider: string;
  createdAt: string;
  paidAt: string | null;
  stripePaymentIntent: string | null;
  bookingId: string | null;
}

export interface StudentBillingViewResult {
  data: BillingRow[];
  anyFailed: boolean;
}

/** Map a raw `payments` row (snake_case) to the camelCase {@link BillingRow} the UI consumes. */
function toBillingRow(r: PaymentDbRow): BillingRow {
  return {
    id: r.id,
    amountUsd: r.amount_usd,
    amountLocal: r.amount_local,
    localCurrency: r.local_currency,
    status: r.status,
    provider: r.provider,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    stripePaymentIntent: r.stripe_payment_intent,
    bookingId: r.booking_id,
  };
}

/**
 * Load the authenticated student's payment history, newest first and bounded by
 * {@link PAYMENTS_HISTORY_LIMIT}. RLS scopes the read to the caller's own rows
 * (`payments_select`); the explicit `.eq("student_id", …)` is defense-in-depth.
 * Fail-soft: a query error yields `{ data: [], anyFailed: true }` rather than throwing.
 *
 * @param supabase  RLS-scoped server client (injected — the unit-test seam).
 * @param studentId Authenticated student's id (from the session, never request input).
 * @returns The mapped {@link BillingRow}s plus an `anyFailed` flag for the page banner.
 */
export async function studentBillingView(
  supabase: ServerClient,
  studentId: string,
): Promise<StudentBillingViewResult> {
  const { data, failed } = loadOrFail<PaymentDbRow[]>(
    await supabase
      .from("payments")
      .select(
        "id, amount_usd, amount_local, local_currency, status, provider, created_at, paid_at, stripe_payment_intent, booking_id",
      )
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(PAYMENTS_HISTORY_LIMIT),
    [],
    { route: "student-billing", widget: "payments-history" },
  );

  return { data: data.map(toBillingRow), anyFailed: failed };
}
