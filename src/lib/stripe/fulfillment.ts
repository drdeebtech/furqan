import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

/**
 * Package purchase fulfillment — called from the Stripe webhook after a successful
 * checkout.session.completed event. Creates the Payment row, Invoice row, and
 * StudentPackage row atomically-as-possible (Supabase does not expose transactions
 * to the JS client, so we do best-effort sequential inserts with rollback).
 *
 * Stripe SDK is NOT imported here — this file only touches our DB. The webhook
 * route verifies the signature and passes the validated payload in.
 */
export interface FulfillmentInput {
  userId: string;
  packageId: string;
  stripePaymentIntentId: string;
  amountUsd: number;
  taxAmount?: number;
  currency?: string;
}

export interface FulfillmentResult {
  ok: boolean;
  paymentId?: string;
  studentPackageId?: string;
  invoiceId?: string;
  error?: string;
}

export async function fulfillPackagePurchase(input: FulfillmentInput): Promise<FulfillmentResult> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data: pkg } = await supabase
    .from("packages")
    .select("id, session_count, price_usd, name, duration_min")
    .eq("id", input.packageId)
    .eq("is_active", true)
    .single<{ id: string; session_count: number; price_usd: number; name: string; duration_min: number }>();

  if (!pkg) return { ok: false, error: "Package not found or inactive" };

  // 1. Payment record
  const { data: payment, error: payErr } = await supabase
    .from("payments")
    .insert({
      student_id: input.userId,
      stripe_payment_intent: input.stripePaymentIntentId,
      amount_usd: input.amountUsd,
      amount_before_tax: input.amountUsd - (input.taxAmount ?? 0),
      tax_rate: 0,
      tax_amount: input.taxAmount ?? 0,
      revenue_recognized: 0,
      status: "succeeded",
      paid_at: now,
    })
    .select("id")
    .single<{ id: string }>();

  if (payErr || !payment) {
    return { ok: false, error: payErr?.message ?? "Failed to create payment" };
  }

  // 2. Student package (expiry: 90 days from now — configurable later)
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: studentPkg, error: spErr } = await supabase
    .from("student_packages")
    .insert({
      student_id: input.userId,
      package_id: input.packageId,
      payment_id: payment.id,
      sessions_total: pkg.session_count,
      sessions_used: 0,
      status: "active",
      purchased_at: now,
      expires_at: expiresAt,
    } as never)
    .select("id")
    .single<{ id: string }>();

  if (spErr || !studentPkg) {
    // Roll back the payment by marking it failed
    const { error: rbErr } = await supabase.from("payments").update({ status: "failed" }).eq("id", payment.id);
    if (rbErr) logError("stripe.fulfillment: payment rollback failed", rbErr, { tag: "stripe", severity: "critical" });
    return { ok: false, error: spErr?.message ?? "Failed to create student_package" };
  }

  // 3. Invoice
  const invoiceNumber = `INV-${Date.now()}-${payment.id.slice(0, 6)}`;
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", input.userId)
    .single<{ full_name: string | null }>();

  const { data: invoice } = await supabase
    .from("invoices")
    .insert({
      payment_id: payment.id,
      student_id: input.userId,
      invoice_number: invoiceNumber,
      issued_at: now,
      student_name_snapshot: profile?.full_name ?? "Unknown",
      amount_usd: input.amountUsd,
      tax_amount: input.taxAmount ?? 0,
      currency: input.currency ?? "USD",
    } as never)
    .select("id")
    .single<{ id: string }>();

  return {
    ok: true,
    paymentId: payment.id,
    studentPackageId: studentPkg.id,
    invoiceId: invoice?.id,
  };
}
