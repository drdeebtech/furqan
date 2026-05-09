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
import { loudAction, notFoundOrInfra } from "@/lib/actions/loud";

type Currency = "USD" | "GBP" | "SAR" | "AUD";

const PRICE_FIELD: Record<Currency, "price_usd" | "price_gbp" | "price_sar" | "price_aud"> = {
  USD: "price_usd",
  GBP: "price_gbp",
  SAR: "price_sar",
  AUD: "price_aud",
};

// PayPal does not support SAR for one-time captures.
const PAYPAL_SUPPORTED: Set<Currency> = new Set(["USD", "GBP", "AUD"]);

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) {
    super(msg, options);
    this.name = "UserError";
  }
}

export type CreateOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; error: string };

/**
 * Step 1 of the PayPal flow. Called from the Smart Buttons `createOrder`
 * callback. Verifies the package + currency, creates a PayPal order, inserts
 * a `payments` row in `pending` status, returns the PayPal orderId so the
 * client can hand it to PayPal for buyer approval.
 *
 * Severity: **critical** — money path. PayPal API failures or the
 * payments-row insert failing fire Telegram alerts via the framework.
 *
 * Multi-field return shape (`{ orderId }`) is preserved by stashing the
 * orderId in `loudAction`'s `message` channel and re-shaping in the public
 * wrapper — the framework's `Output: { message?: string }` constraint
 * doesn't allow extra typed fields directly.
 */
type CreateOrderInput = { packageId: string; currency: Currency };

const createPackageOrderBase = loudAction<CreateOrderInput, { message: string }>({
  name: "paypal.create-package-order",
  severity: "critical",
  audit: {
    table: "payments",
    recordId: (i) => i.packageId,
    action: "INSERT",
    reasonPrefix: "paypal create package order",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("الرجاء تسجيل الدخول أولاً");
    return { actorId: user.id };
  },
  handler: async ({ packageId, currency }, { actorId }) => {
    // 0. Feature flag — refuse if not enabled.
    const settings = await getSettings();
    if (settings.paypal_purchase_enabled !== "true") {
      throw new UserError("الدفع عبر PayPal غير مفعّل حالياً");
    }

    // 1. Validate currency.
    if (!PAYPAL_SUPPORTED.has(currency)) {
      throw new UserError("PayPal لا يدعم هذه العملة. الرجاء اختيار USD أو GBP أو AUD.");
    }

    const supabase = await createClient();

    // 2. Load package (active only).
    const { data: pkg, error: pkgErr } = await supabase
      .from("packages")
      .select("id, name, name_ar, package_type, price_usd, price_gbp, price_sar, price_aud, session_count, is_active")
      .eq("id", packageId)
      .eq("is_active", true)
      .single<{
        id: string; name: string; name_ar: string | null; package_type: string;
        price_usd: number; price_gbp: number | null; price_sar: number | null; price_aud: number | null;
        session_count: number; is_active: boolean;
      }>();
    if (pkgErr || !pkg) throw notFoundOrInfra(pkgErr, "الباقة غير متاحة");

    const priceField = PRICE_FIELD[currency];
    const price = pkg[priceField];
    if (price === null || price === undefined) {
      throw new UserError("السعر غير متوفر بهذه العملة");
    }

    // 3. Create the PayPal order.
    let orderId: string;
    let mode: string;
    try {
      const order = await createOrder({
        amount: Number(price),
        currencyCode: currency,
        description: pkg.name_ar ?? pkg.name,
        customId: `pkg:${pkg.id}:user:${actorId}`,
      });
      orderId = order.orderId;
      mode = order.mode;
    } catch (err) {
      throw new UserError("حدث خطأ أثناء بدء الدفع. حاول مرة أخرى.", { cause: err });
    }

    // 4. Persist a pending `payments` row. Admin client because RLS would
    // otherwise refuse the student's own write to a row whose policies
    // assume admin/system insert.
    const admin = createAdminClient();
    const { error: insErr } = await admin.from("payments").insert({
      student_id: actorId!,
      provider: "paypal",
      paypal_order_id: orderId,
      package_id: pkg.id,
      amount_usd: Number(pkg.price_usd),                 // canonical USD reference
      amount_local: Number(price),                       // what the buyer actually pays
      local_currency: currency,
      status: "pending",
    });
    if (insErr) {
      // Hard fail — surface to user so they don't think they've paid when no
      // record exists. The PayPal order will simply expire unfinalized.
      throw new UserError("تعذر إنشاء طلب الدفع", { cause: insErr });
    }

    // Sentry breadcrumb for the happy path so the capture step can correlate.
    Sentry.addBreadcrumb({
      category: "paypal",
      message: `order created (${mode})`,
      data: { orderId, packageId: pkg.id, currency },
      level: "info",
    });

    // Stash orderId in `message` for the public wrapper to re-shape into the
    // existing `{ ok: true, orderId }` contract.
    return { message: orderId };
  },
});

export async function createPackageOrder(input: {
  packageId: string;
  currency: Currency;
}): Promise<CreateOrderResult> {
  const result = await createPackageOrderBase(input);
  if (!result.ok) return { ok: false, error: result.error };
  // result.message holds the orderId per the wrap above.
  return { ok: true, orderId: result.message ?? "" };
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
 *
 * Severity: **critical** — money already changed hands at PayPal. Every
 * post-capture failure path must Telegram-alert immediately so an admin
 * can reconcile manually.
 *
 * Same `message`-as-id transport as createPackageOrder: studentPackageId is
 * stashed in `message` and re-shaped in the public wrapper.
 */
const captureAndGrantPackageBase = loudAction<{ orderId: string }, { message: string }>({
  name: "paypal.capture-and-grant-package",
  severity: "critical",
  audit: {
    table: "student_packages",
    recordId: (i) => i.orderId,
    action: "INSERT",
    reasonPrefix: "paypal capture and grant package",
  },
  preflight: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UserError("الرجاء تسجيل الدخول أولاً");
    return { actorId: user.id };
  },
  handler: async ({ orderId }, { actorId }) => {
    // 1. Look up the pending payments row, verify ownership.
    const admin = createAdminClient();
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .select("id, student_id, paypal_order_id, status, amount_local, local_currency, amount_usd, package_id")
      .eq("paypal_order_id" as never, orderId)
      .single<{
        id: string; student_id: string; paypal_order_id: string;
        status: string; amount_local: number | null; local_currency: string | null;
        amount_usd: number; package_id: string | null;
      }>();
    if (payErr || !payment) throw notFoundOrInfra(payErr, "طلب الدفع غير موجود");

    if (payment.student_id !== actorId) {
      // Critical: someone is attempting to capture another user's order.
      // Throw with cause attached so framework Telegram-alerts on critical.
      throw new UserError("هذا الطلب يخص حساباً آخر", {
        cause: new Error(`paypal capture ownership mismatch — payment.student_id=${payment.student_id} actor=${actorId} order=${orderId}`),
      });
    }

    // Idempotency + partial-failure recovery.
    //
    // Three states to handle when payment.status === "succeeded":
    //   (a) student_packages row exists  → fully done, return its id.
    //   (b) student_packages row missing → previous run captured + updated
    //       payments but crashed BEFORE inserting student_packages. We
    //       must NOT re-capture (PayPal will reject "already captured" or
    //       — worse on some flows — double-charge). Skip to the
    //       package-grant step using the stored capture data.
    //   (c) Capture not yet performed (status='pending') → run the full
    //       capture-then-grant path.
    //
    // (Flagged by CodeRabbit on PR #271 — closing the gap for state (b).)
    let paymentAlreadyCaptured = false;
    if (payment.status === "succeeded") {
      const { data: existing } = await admin
        .from("student_packages").select("id").eq("payment_id", payment.id).maybeSingle<{ id: string }>();
      if (existing) return { message: existing.id };
      paymentAlreadyCaptured = true;
    }

    if (!paymentAlreadyCaptured) {
      // 2. Capture at PayPal.
      let capture: Awaited<ReturnType<typeof captureOrder>>;
      try {
        capture = await captureOrder(orderId);
      } catch (err) {
        throw new UserError("حدث خطأ أثناء إتمام الدفع. تواصل مع الدعم.", { cause: err });
      }

      // 3. Mark the payment captured.
      const { error: updErr } = await admin.from("payments")
        .update({
          status: "succeeded",
          paypal_capture_id: capture.captureId,
          captured_at: new Date().toISOString(),
          payer_email: capture.payerEmail,
          paid_at: new Date().toISOString(),
        })
        .eq("id", payment.id);
      if (updErr) {
        // Critical: PayPal has the money but our payments row didn't update.
        throw new UserError("تم الدفع لكن تعذر تحديث السجل. تم إخطار الإدارة.", { cause: updErr });
      }
    }

    // 4. Resolve the package via the explicit FK we stored at order-creation time.
    if (!payment.package_id) {
      throw new UserError("تم الدفع لكن لم نتمكن من ربط الباقة. تواصل مع الدعم.", {
        cause: new Error(`payments row ${payment.id} missing package_id`),
      });
    }
    const { data: pkgRow, error: pkgErr } = await admin
      .from("packages")
      .select("id, session_count")
      .eq("id", payment.package_id)
      .maybeSingle<{ id: string; session_count: number }>();
    if (pkgErr) throw notFoundOrInfra(pkgErr, "تم الدفع لكن لم نتمكن من ربط الباقة. تواصل مع الدعم.");
    if (!pkgRow) {
      throw new UserError("تم الدفع لكن لم نتمكن من ربط الباقة. تواصل مع الدعم.", {
        cause: new Error(`package_id ${payment.package_id} not resolvable post-capture`),
      });
    }

    // 5. Insert student_packages row.
    const { data: studentPkg, error: spErr } = await admin
      .from("student_packages")
      .insert({
        student_id: actorId!,
        package_id: pkgRow.id,
        payment_id: payment.id,
        sessions_total: pkgRow.session_count,
        sessions_used: 0,
        status: "active",
      } as never)
      .select("id")
      .single<{ id: string }>();
    if (spErr || !studentPkg) {
      throw new UserError("تم الدفع لكن لم نمنح الباقة. تواصل مع الدعم.", { cause: spErr });
    }

    // 6. Side effects — fire-and-forget. Don't fail the user if these throw.
    emitEvent("package.purchased", "student_package", studentPkg.id, {
      student_id: actorId!,
      package_id: pkgRow.id,
      payment_id: payment.id,
      sessions_total: pkgRow.session_count,
      amount_usd: payment.amount_usd,
    }).catch((e) => logError("emit package.purchased failed", e, { tag: "automation" }));

    notify({
      userId: actorId!,
      type: "payment",
      title: "تم تفعيل الباقة",
      body: `استلمنا دفعتك بنجاح. يمكنك الآن حجز ${pkgRow.session_count} جلسة.`,
      entityType: "student_package",
      entityId: studentPkg.id,
    }).catch((e) => logError("notify student package purchased failed", e, { tag: "notify" }));

    revalidatePath("/student/packages");
    return { message: studentPkg.id };
  },
});

export async function captureAndGrantPackage(input: {
  orderId: string;
}): Promise<CaptureResult> {
  const result = await captureAndGrantPackageBase(input);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, studentPackageId: result.message ?? "" };
}
