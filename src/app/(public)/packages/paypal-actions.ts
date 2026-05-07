"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import { emitEvent } from "@/lib/automation/emit";
import { notify } from "@/lib/notifications/dispatcher";
import { createOrder, captureOrder } from "@/lib/paypal/client";

type Currency = "USD" | "GBP" | "SAR" | "AUD";

const PRICE_FIELD: Record<Currency, "price_usd" | "price_gbp" | "price_sar" | "price_aud"> = {
  USD: "price_usd",
  GBP: "price_gbp",
  SAR: "price_sar",
  AUD: "price_aud",
};

// PayPal does not support SAR for one-time captures.
const PAYPAL_SUPPORTED: Set<Currency> = new Set(["USD", "GBP", "AUD"]);

export type CreateOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; error: string };

/**
 * Step 1 of the PayPal flow. Called from the Smart Buttons `createOrder`
 * callback. Verifies the package + currency, creates a PayPal order, inserts
 * a `payments` row in `pending` status, returns the PayPal orderId so the
 * client can hand it to PayPal for buyer approval.
 */
export async function createPackageOrder(input: {
  packageId: string;
  currency: Currency;
}): Promise<CreateOrderResult> {
  try {
    // 0. Feature flag — refuse if not enabled.
    const settings = await getSettings();
    if (settings.paypal_purchase_enabled !== "true") {
      return { ok: false, error: "الدفع عبر PayPal غير مفعّل حالياً" };
    }

    // 1. Auth — must be a logged-in student.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "الرجاء تسجيل الدخول أولاً" };

    // 2. Validate currency.
    if (!PAYPAL_SUPPORTED.has(input.currency)) {
      return {
        ok: false,
        error: "PayPal لا يدعم هذه العملة. الرجاء اختيار USD أو GBP أو AUD.",
      };
    }

    // 3. Load package (active only).
    const { data: pkg, error: pkgErr } = await supabase
      .from("packages")
      .select("id, name, name_ar, package_type, price_usd, price_gbp, price_sar, price_aud, session_count, is_active")
      .eq("id", input.packageId)
      .eq("is_active", true)
      .single<{
        id: string; name: string; name_ar: string | null; package_type: string;
        price_usd: number; price_gbp: number | null; price_sar: number | null; price_aud: number | null;
        session_count: number; is_active: boolean;
      }>();

    if (pkgErr || !pkg) return { ok: false, error: "الباقة غير متاحة" };

    const priceField = PRICE_FIELD[input.currency];
    const price = pkg[priceField];
    if (price === null || price === undefined) {
      return { ok: false, error: "السعر غير متوفر بهذه العملة" };
    }

    // 4. Create the PayPal order.
    const { orderId, mode } = await createOrder({
      amount: Number(price),
      currencyCode: input.currency,
      description: pkg.name_ar ?? pkg.name,
      customId: `pkg:${pkg.id}:user:${user.id}`,
    });

    // 5. Persist a pending `payments` row. Admin client because RLS would
    // otherwise refuse the student's own write to a row whose policies
    // assume admin/system insert.
    const admin = createAdminClient();
    const { error: insErr } = await admin.from("payments").insert({
      student_id: user.id,
      provider: "paypal",
      paypal_order_id: orderId,
      package_id: pkg.id,
      amount_usd: Number(pkg.price_usd),                 // canonical USD reference
      amount_local: Number(price),                       // what the buyer actually pays
      local_currency: input.currency,
      status: "pending",
    } as never);

    if (insErr) {
      // Hard fail — surface to user so they don't think they've paid when no
      // record exists. The PayPal order will simply expire unfinalized.
      logError("paypal createPackageOrder: payments insert failed", insErr, {
        tag: "paypal", severity: "warning", orderId, userId: user.id, packageId: pkg.id,
      });
      return { ok: false, error: "تعذر إنشاء طلب الدفع" };
    }

    // Sentry breadcrumb for the happy path so the capture step can correlate.
    Sentry.addBreadcrumb({
      category: "paypal",
      message: `order created (${mode})`,
      data: { orderId, packageId: pkg.id, currency: input.currency },
      level: "info",
    });

    return { ok: true, orderId };
  } catch (err) {
    logError("paypal createPackageOrder threw", err, { tag: "paypal", severity: "warning" });
    return { ok: false, error: "حدث خطأ أثناء بدء الدفع. حاول مرة أخرى." };
  }
}

export type CaptureResult =
  | { ok: true; studentPackageId: string }
  | { ok: false; error: string };

/**
 * Step 2 of the PayPal flow. Called from Smart Buttons `onApprove`.
 *
 * Capture-then-grant ordering: the PayPal capture is committed FIRST.
 * If the subsequent DB inserts fail, we mark the payment row
 * `status='succeeded'` but log critical so admin can manually grant the
 * package. We do NOT auto-refund — refund logic is its own surface.
 */
export async function captureAndGrantPackage(input: {
  orderId: string;
}): Promise<CaptureResult> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "الرجاء تسجيل الدخول أولاً" };

    // 1. Look up the pending payments row, verify ownership.
    // `as never` on the .eq column name because the generated types haven't
    // been regenerated against the new migration yet — `npm run db:types`
    // after the migration applies will remove this cast.
    const admin = createAdminClient();
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .select("id, student_id, paypal_order_id, status, amount_local, local_currency, amount_usd, package_id")
      .eq("paypal_order_id" as never, input.orderId)
      .single<{
        id: string; student_id: string; paypal_order_id: string;
        status: string; amount_local: number | null; local_currency: string | null;
        amount_usd: number; package_id: string | null;
      }>();

    if (payErr || !payment) return { ok: false, error: "طلب الدفع غير موجود" };
    if (payment.student_id !== user.id) {
      logError("paypal capture: ownership mismatch", new Error("student_id mismatch"), {
        tag: "paypal", severity: "critical",
        userId: user.id, paymentStudentId: payment.student_id, orderId: input.orderId,
      });
      return { ok: false, error: "هذا الطلب يخص حساباً آخر" };
    }

    // Idempotency: if already captured, return the linked student_package.
    if (payment.status === "succeeded") {
      const { data: existing } = await admin
        .from("student_packages").select("id").eq("payment_id", payment.id).maybeSingle<{ id: string }>();
      if (existing) return { ok: true, studentPackageId: existing.id };
    }

    // 2. Capture at PayPal.
    const capture = await captureOrder(input.orderId);

    // 3. Mark the payment captured.
    const { error: updErr } = await admin.from("payments")
      .update({
        status: "succeeded",
        paypal_capture_id: capture.captureId,
        captured_at: new Date().toISOString(),
        payer_email: capture.payerEmail,
        paid_at: new Date().toISOString(),
      } as never)
      .eq("id", payment.id);

    if (updErr) {
      // Critical: PayPal has the money but our payments row didn't update.
      // Telegram-alert via logError severity:critical so admin can reconcile.
      logError("paypal capture: payments row update failed AFTER capture", updErr, {
        tag: "paypal", severity: "critical",
        orderId: input.orderId, captureId: capture.captureId, userId: user.id,
      });
      return { ok: false, error: "تم الدفع لكن تعذر تحديث السجل. تم إخطار الإدارة." };
    }

    // 4. Resolve the package via the explicit FK we stored at order-creation time.
    if (!payment.package_id) {
      logError("paypal capture: payments row missing package_id", new Error("no package_id"), {
        tag: "paypal", severity: "critical", paymentId: payment.id,
      });
      return { ok: false, error: "تم الدفع لكن لم نتمكن من ربط الباقة. تواصل مع الدعم." };
    }
    const { data: pkgRow } = await admin
      .from("packages")
      .select("id, session_count")
      .eq("id", payment.package_id)
      .maybeSingle<{ id: string; session_count: number }>();

    if (!pkgRow) {
      logError("paypal capture: could not resolve package post-capture", new Error("no package match"), {
        tag: "paypal", severity: "critical",
        paymentId: payment.id, amountUsd: payment.amount_usd,
      });
      return { ok: false, error: "تم الدفع لكن لم نتمكن من ربط الباقة. تواصل مع الدعم." };
    }

    // 5. Insert student_packages row.
    const { data: studentPkg, error: spErr } = await admin
      .from("student_packages")
      .insert({
        student_id: user.id,
        package_id: pkgRow.id,
        payment_id: payment.id,
        sessions_total: pkgRow.session_count,
        sessions_used: 0,
        status: "active",
      } as never)
      .select("id")
      .single<{ id: string }>();

    if (spErr || !studentPkg) {
      logError("paypal capture: student_packages insert failed AFTER capture", spErr, {
        tag: "paypal", severity: "critical",
        paymentId: payment.id, userId: user.id, packageId: pkgRow.id,
      });
      return { ok: false, error: "تم الدفع لكن لم نمنح الباقة. تواصل مع الدعم." };
    }

    // 6. Side effects — fire-and-forget. Don't fail the user if these throw.
    emitEvent("package.purchased", "student_package", studentPkg.id, {
      student_id: user.id, package_id: pkgRow.id, payment_id: payment.id,
      sessions_total: pkgRow.session_count, amount_usd: payment.amount_usd,
    }).catch((e) => logError("emit package.purchased failed", e, { tag: "automation" }));

    notify({
      userId: user.id,
      type: "payment",
      title: "تم تفعيل الباقة",
      body: `استلمنا دفعتك بنجاح. يمكنك الآن حجز ${pkgRow.session_count} جلسة.`,
      entityType: "student_package",
      entityId: studentPkg.id,
    }).catch((e) => logError("notify student package purchased failed", e, { tag: "notify" }));

    revalidatePath("/student/packages");
    return { ok: true, studentPackageId: studentPkg.id };
  } catch (err) {
    logError("paypal captureAndGrantPackage threw", err, { tag: "paypal", severity: "critical" });
    return { ok: false, error: "حدث خطأ أثناء إتمام الدفع. تواصل مع الدعم." };
  }
}
