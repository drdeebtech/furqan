"use server";

// Spec 040 Phase 2 — Teacher Agreement acceptance + Connect onboarding actions.
// Thin shells (constitution I): identity from the session ONLY (never the
// body — FR-001/FR-028), policy in ./onboarding-policy, atomicity in the
// connect_accept_agreement RPC, Stripe orchestration in ./connect-accounts.
// Neither action takes ANY client input — there is nothing to zod-validate,
// and a foreign teacher_id in a request body is structurally ignored.

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { callRpc } from "@/lib/supabase/rpc";
import { getClientIp } from "@/lib/security/client-ip";
import { logError } from "@/lib/logger";
import { getStripe } from "@/lib/stripe/client";
import { deriveAccountStatus, mintOnboardingLink } from "@/lib/domains/connect/connect-accounts";
import { createConnectAccountsStore } from "@/lib/domains/connect/connect-accounts-store";
import {
  decideOnboardingRoute,
  type OnboardingFacts,
} from "@/lib/domains/connect/onboarding-policy";
import { AGREEMENT_TEXT_IS_PLACEHOLDER } from "@/lib/connect/agreement-content";
import type { PayoutMethod } from "@/lib/domains/connect/transfer-sweep";

type AcceptResult =
  | { ok: true; version: string; newlyAccepted: boolean; releasedEntries: number }
  | {
      ok: false;
      error: string;
      /** The agreement changed between render and click — re-render this version. */
      versionChanged?: true;
      currentVersion?: string;
    };

type OnboardingResult =
  | { ok: true; kind: "stripe"; url: string }
  | { ok: true; kind: "manual" }
  | { ok: true; kind: "already_enabled" }
  | { ok: false; error: string };

interface TeacherFactsRow {
  teacher_id: string;
  cv_status: string | null;
  is_archived: boolean;
  payout_method: string;
}

/** Session-derived teacher facts (RLS: own row). Null = no teacher profile. */
async function readTeacherFacts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ facts: OnboardingFacts } | { readError: true }> {
  const { data, error } = await supabase
    .from("teacher_profiles")
    .select("teacher_id, cv_status, is_archived, payout_method")
    .eq("teacher_id", userId)
    .maybeSingle<TeacherFactsRow>();
  if (error) {
    logError("teacher-payouts: teacher_profiles read failed", error, {
      tag: "connect",
      metadata: { actionName: "readTeacherFacts", userId },
    });
    return { readError: true };
  }
  return {
    facts: {
      hasTeacherProfile: data !== null,
      cvStatus: data?.cv_status ?? null,
      isArchived: data?.is_archived ?? false,
      payoutMethod: (data?.payout_method as PayoutMethod | undefined) ?? null,
    },
  };
}

/**
 * FR-028: record the teacher's explicit acceptance of the CURRENT agreement
 * version (server-derived from settings — the client cannot choose what it
 * consents to) and atomically release any held/agreement_pending earnings
 * (SC-014). Replay-safe: re-accepting the same version is a no-op.
 *
 * `expectedVersion` is the version string the UI RENDERED — an attestation,
 * not a choice: if the owner bumped the agreement between render and click,
 * the RPC refuses (outcome 'version_changed') instead of recording consent
 * to text the teacher never saw (review finding). The only client input, and
 * it can only cause a refusal.
 */
export async function acceptTeacherAgreement(expectedVersion?: string): Promise<AcceptResult> {
  // Server-side draft guard (review P4 — defense in depth): the UI disables
  // accept while the text is a placeholder, but a crafted client call must
  // not be able to record consent to unreviewed text either.
  if (AGREEMENT_TEXT_IS_PLACEHOLDER) {
    return { ok: false, error: "الاتفاقية غير متاحة للموافقة بعد — النص النهائي قيد المراجعة" };
  }
  // Boundary validation for the one client-supplied value (no zod dep needed
  // for a single bounded string): non-string / oversized → ignore it, which
  // degrades to the version-unchecked path, never a crash.
  const attestedVersion =
    typeof expectedVersion === "string" &&
    expectedVersion.trim() !== "" &&
    expectedVersion.length <= 64
      ? expectedVersion.trim()
      : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مصرح — يرجى تسجيل الدخول" };

  const read = await readTeacherFacts(supabase, user.id);
  if ("readError" in read) return { ok: false, error: "تعذر التحقق من الحساب — حاول مجددًا" };
  if (!read.facts.hasTeacherProfile) {
    return { ok: false, error: "هذه الصفحة مخصصة للمعلمين فقط" };
  }

  // Consent evidence (FR-028a, minimized): trusted-proxy IP or null, UA ≤255.
  const requestHeaders = await headers();
  const ip = getClientIp(requestHeaders);
  const userAgent = requestHeaders.get("user-agent")?.slice(0, 255) || null;

  const { data, error } = await callRpc(createAdminClient(), "connect_accept_agreement", {
    p_teacher_id: user.id,
    p_accepted_by: user.id,
    p_ip: ip,
    p_user_agent: userAgent,
    p_expected_version: attestedVersion,
  });
  if (error) {
    logError("teacher-payouts: connect_accept_agreement rpc failed", error, {
      tag: "connect",
      metadata: { actionName: "acceptTeacherAgreement", teacherId: user.id },
    });
    return { ok: false, error: "تعذر تسجيل الموافقة — حاول مجددًا" };
  }
  const row = data?.[0];
  if (!row) {
    logError("teacher-payouts: connect_accept_agreement returned no row", null, {
      tag: "connect",
      metadata: { actionName: "acceptTeacherAgreement", teacherId: user.id },
    });
    return { ok: false, error: "تعذر تسجيل الموافقة — حاول مجددًا" };
  }
  if (row.outcome === "version_changed") {
    return {
      ok: false,
      error: "تم تحديث الاتفاقية — يرجى قراءة النسخة الجديدة والموافقة عليها",
      versionChanged: true,
      currentVersion: row.agreement_version,
    };
  }
  return {
    ok: true,
    version: row.agreement_version,
    newlyAccepted: row.newly_accepted,
    releasedEntries: row.released_entries,
  };
}

/**
 * FR-001/FR-004: create-or-reuse the teacher's Express account and mint a
 * hosted-onboarding Account Link. Approved teachers only (review-binding
 * gate); manual-rail teachers get the "handled by the academy" state and
 * never a link. Return/refresh URLs are SERVER-constructed constants —
 * never derived from user input (open-redirect hard line).
 */
export async function startConnectOnboarding(): Promise<OnboardingResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "غير مصرح — يرجى تسجيل الدخول" };

  const read = await readTeacherFacts(supabase, user.id);
  if ("readError" in read) return { ok: false, error: "تعذر التحقق من الحساب — حاول مجددًا" };

  const route = decideOnboardingRoute(read.facts);
  if (route === "not_teacher") return { ok: false, error: "هذه الصفحة مخصصة للمعلمين فقط" };
  if (route === "not_approved") {
    return { ok: false, error: "يتاح إعداد المدفوعات بعد اعتماد ملفك التعليمي" };
  }
  if (route === "manual_rail") return { ok: true, kind: "manual" };

  // Loud failure on missing base URL (review finding — the portal route's
  // idiom): a silently minted localhost return URL would strand a teacher
  // who just finished Stripe onboarding on a dead redirect.
  const rawBase = process.env.NEXT_PUBLIC_APP_URL;
  if (!rawBase) {
    logError("teacher-payouts: NEXT_PUBLIC_APP_URL not configured", new Error("config-missing"), {
      tag: "connect",
      metadata: { actionName: "startConnectOnboarding" },
    });
    return { ok: false, error: "الخدمة غير متاحة حاليًا — حاول لاحقًا" };
  }
  const base = rawBase.replace(/\/$/, "");
  try {
    const store = createConnectAccountsStore();
    // Short-circuit for a finished teacher (security review P3): no reason to
    // mint a fresh Account Link — and burn a Stripe API call — when payouts
    // are already enabled. Also the correct UX: the card shows the enabled
    // state, not an onboarding link.
    const existing = await store.getByTeacherId(user.id);
    if (deriveAccountStatus(existing) === "payouts_enabled") {
      return { ok: true, kind: "already_enabled" };
    }
    const url = await mintOnboardingLink(
      { store, stripe: getStripe() },
      {
        teacherId: user.id,
        refreshUrl: `${base}/teacher/payouts?link=refresh`,
        returnUrl: `${base}/teacher/payouts?link=return`,
      },
    );
    return { ok: true, kind: "stripe", url };
  } catch (error) {
    // Loud failure (constitution II): Stripe/store errors reach Sentry with
    // the action tag; the teacher gets a retryable message, never a broken
    // half-created state (create-or-reuse makes the retry idempotent).
    logError("teacher-payouts: startConnectOnboarding failed", error, {
      tag: "connect",
      metadata: { actionName: "startConnectOnboarding", teacherId: user.id },
    });
    return { ok: false, error: "تعذر بدء إعداد المدفوعات — حاول مجددًا" };
  }
}
