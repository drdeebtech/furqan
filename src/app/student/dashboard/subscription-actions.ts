"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, ForbiddenError, UnauthenticatedError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import {
  cancelPayPalSubscription,
  isPayPalConfigured,
} from "@/lib/paypal/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const CancelCurrentSubscriptionInput = z.object({}).strict();

const PAYPAL_CANCEL_REASON =
  "Student requested subscription cancellation from the Furqan dashboard.";

const MESSAGES = {
  invalidInput: "بيانات غير صالحة / Invalid request.",
  unauthenticated: "يجب تسجيل الدخول أولاً / Please sign in first.",
  forbidden: "ليس لديك صلاحية لهذا الاشتراك / You do not have permission for this subscription.",
  notFound: "لا يوجد اشتراك نشط قابل للإلغاء / No active subscription is available to cancel.",
  unsupportedProvider: "إدارة هذا الاشتراك تتم من بوابة الدفع / Manage this subscription from the billing portal.",
  missingPayPalId: "تعذر إلغاء الاشتراك الآن — حاول مرة أخرى / We could not cancel right now. Please try again.",
  notConfigured: "إلغاء PayPal غير متاح حالياً — حاول لاحقاً / PayPal cancellation is unavailable right now. Please try later.",
  retryable: "تعذر إلغاء الاشتراك الآن — حاول مرة أخرى / We could not cancel right now. Please try again.",
} as const;

export type CancelSubscriptionActionResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "invalid_input"
        | "unauthenticated"
        | "forbidden"
        | "not_found"
        | "unsupported_provider"
        | "not_configured"
        | "retryable";
      error: string;
    };

type SubscriptionRow = {
  id: string;
  student_id: string;
  provider: string;
  provider_subscription_id: string | null;
  status: string;
  cancel_at_period_end: boolean;
};

const subscriptionSelectColumns =
  "id, student_id, provider, provider_subscription_id, status, cancel_at_period_end" as const;

function failure(
  code: Exclude<CancelSubscriptionActionResult, { ok: true }>["code"],
  error: string,
): CancelSubscriptionActionResult {
  return { ok: false, code, error };
}

export async function cancelCurrentStudentPayPalSubscription(
  input?: unknown,
): Promise<CancelSubscriptionActionResult> {
  const parsed = CancelCurrentSubscriptionInput.safeParse(input ?? {});
  if (!parsed.success) {
    return failure("invalid_input", MESSAGES.invalidInput);
  }

  let studentId: string;
  try {
    const actor = await requireRole("student");
    studentId = actor.id;
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      return failure("unauthenticated", MESSAGES.unauthenticated);
    }
    if (err instanceof ForbiddenError) {
      return failure("forbidden", MESSAGES.forbidden);
    }
    throw err;
  }

  const supabase = await createClient();
  const { data: subscription, error: readError } = await supabase
    .from("subscriptions")
    .select(subscriptionSelectColumns)
    .eq("student_id", studentId)
    .eq("provider", "paypal")
    .eq("status", "active")
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>();

  if (readError) {
    logError("student subscription cancel: read failed", readError, {
      tag: "billing",
      student_id: studentId,
    });
    return failure("retryable", MESSAGES.retryable);
  }

  if (!subscription) {
    const { data: alreadyCancelingSubscription, error: alreadyCancelingReadError } = await supabase
      .from("subscriptions")
      .select(subscriptionSelectColumns)
      .eq("student_id", studentId)
      .eq("provider", "paypal")
      .eq("cancel_at_period_end", true)
      .order("current_period_end", { ascending: false })
      .limit(1)
      .maybeSingle<SubscriptionRow>();

    if (alreadyCancelingReadError) {
      logError("student subscription cancel: idempotency read failed", alreadyCancelingReadError, {
        tag: "billing",
        student_id: studentId,
      });
      return failure("retryable", MESSAGES.retryable);
    }

    if (alreadyCancelingSubscription) {
      if (alreadyCancelingSubscription.student_id !== studentId) {
        return failure("forbidden", MESSAGES.forbidden);
      }
      return { ok: true };
    }

    const { data: canceledSubscription, error: canceledReadError } = await supabase
      .from("subscriptions")
      .select(subscriptionSelectColumns)
      .eq("student_id", studentId)
      .eq("provider", "paypal")
      .eq("status", "canceled")
      .order("current_period_end", { ascending: false })
      .limit(1)
      .maybeSingle<SubscriptionRow>();

    if (canceledReadError) {
      logError("student subscription cancel: canceled-state read failed", canceledReadError, {
        tag: "billing",
        student_id: studentId,
      });
      return failure("retryable", MESSAGES.retryable);
    }

    if (canceledSubscription) {
      if (canceledSubscription.student_id !== studentId) {
        return failure("forbidden", MESSAGES.forbidden);
      }
      return { ok: true };
    }

    return failure("not_found", MESSAGES.notFound);
  }

  if (subscription.student_id !== studentId) {
    return failure("forbidden", MESSAGES.forbidden);
  }

  if (subscription.provider !== "paypal") {
    return failure("unsupported_provider", MESSAGES.unsupportedProvider);
  }

  if (subscription.cancel_at_period_end || subscription.status === "canceled") {
    return { ok: true };
  }

  if (!subscription.provider_subscription_id) {
    logError("student subscription cancel: missing PayPal subscription id", new Error("missing provider_subscription_id"), {
      tag: "billing",
      subscription_id: subscription.id,
      student_id: studentId,
    });
    return failure("retryable", MESSAGES.missingPayPalId);
  }

  if (!isPayPalConfigured()) {
    return failure("not_configured", MESSAGES.notConfigured);
  }

  try {
    await cancelPayPalSubscription(
      subscription.provider_subscription_id,
      PAYPAL_CANCEL_REASON,
    );
  } catch (err) {
    logError("student subscription cancel: PayPal call failed", err, {
      tag: "billing",
      subscription_id: subscription.id,
      student_id: studentId,
    });
    return failure("retryable", MESSAGES.retryable);
  }

  const admin = createAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("subscriptions")
    .update({ cancel_at_period_end: true })
    .eq("id", subscription.id)
    .eq("provider", "paypal")
    .eq("status", "active")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (updateError || !updated) {
    logError("student subscription cancel: local update failed", updateError ?? new Error("subscription update matched no rows"), {
      tag: "billing",
      subscription_id: subscription.id,
      student_id: studentId,
    });
    return failure("retryable", MESSAGES.retryable);
  }

  revalidatePath("/student/dashboard");
  return { ok: true };
}
