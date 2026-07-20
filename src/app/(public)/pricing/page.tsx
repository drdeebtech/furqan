import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BreadcrumbSchema } from "@/components/seo/structured-data";
import { BASE_URL } from "@/lib/constants";
import { logError } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import {
  PREPAID_DEFAULT_RATE_USD as DEFAULT_RATE_USD,
  PREPAID_DEFAULT_CUSTOM_MIN as DEFAULT_CUSTOM_MIN,
  PREPAID_DEFAULT_CUSTOM_MAX as DEFAULT_CUSTOM_MAX,
} from "@/lib/domains/billing/prepaid-defaults";
import { PricingContent, type Faq, type PrepaidConfig, type Track } from "./content";

export const metadata: Metadata = {
  title: "الأسعار — اشتراكات حفظ القرآن",
  description:
    "خطط اشتراك شهرية لحفظ القرآن الكريم: حلقات جماعية وجلسات فردية. اختر الخطة المناسبة لك وابدأ رحلتك اليوم.",
  alternates: { canonical: `${BASE_URL}/pricing` },
};

// ── Spec 038 — prepaid-hour wallet server-side gating (T6.1) ────────────────
// The `prepaid_hours_purchase_enabled` flag is SERVER-SIDE ONLY: the client
// `useFeatureFlags()` context does NOT carry this key (it's not in the public
// flags bundle), so the gate happens here and the parsed config is passed to
// <PricingContent> as the `prepaid` prop (null when the flag is off → the
// entire pay-as-you-go surface is hidden). All money knobs are DATA
// (platform_settings), parsed defensively: blank/non-finite → seeded default.

// Rate/bounds defaults are shared with both checkout routes so the price shown
// here can never disagree with the price charged.
const DEFAULT_PRESETS = [5, 10, 20];

function parseRate(raw: string | null): number {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_RATE_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RATE_USD;
  // Match the route's cents-safe rounding (rate × 100 must be an integer).
  return Math.round(n * 100) / 100;
}

function parsePresets(raw: string | null): number[] {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_PRESETS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PRESETS;
    const nums = parsed
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n > 0)
      .map((n) => Math.floor(n));
    const unique = Array.from(new Set(nums)).sort((a, b) => a - b);
    return unique.length > 0 ? unique : DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

function parseBound(raw: string | null, fallback: number): number {
  if (raw === null || raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/** Validate `?track=` at the boundary — anything unrecognised means "show all". */
function parseTrack(raw: string | string[] | undefined): Track | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "group" || v === "private" ? v : null;
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ track?: string | string[] }>;
}) {
  const supabase = await createClient();
  const track = parseTrack((await searchParams).track);

  // Where a plan CTA should point depends on WHO is asking. A signed-out
  // visitor needs to create an account first (/register carries the plan into
  // the signup form); a signed-in student must NOT be sent to a registration
  // page — the proxy bounces them off /register to their dashboard and the
  // chosen plan is silently discarded, so they land nowhere useful having lost
  // their choice. /subscribe is the real checkout entry and already handles the
  // signed-in case directly.
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  // Route to /register ONLY when we positively know the visitor is signed out.
  // A transient auth-lookup failure must not be read as "signed out": that
  // would send a real, signed-in student to /register and reinstate exactly the
  // plan-losing bug this fixes. So on error we fail toward /subscribe, which is
  // safe for BOTH audiences — it bounces an anonymous visitor to /login
  // carrying ?plan=, whereas /register destroys the plan for a signed-in one.
  // Uncertainty therefore costs a signed-out visitor one extra hop; the
  // alternative costs a signed-in student their choice, silently.
  const treatAsAuthenticated = Boolean(user) || Boolean(authError);
  if (authError) {
    logError("pricing: auth lookup failed, routing CTAs to checkout", authError, {
      tag: "pricing",
    });
  }

  // G2: /pricing is the CANONICAL FAQ surface — policy-driven entries from
  // src/lib/copy/policies.ts plus the admin-managed site_faqs rows (the same
  // rows /contact renders), so admin edits appear here with no code change.
  const [plansRes, faqsRes] = await Promise.all([
    supabase
      .from("subscription_plans")
      .select("id, plan_code, name, monthly_credit_count, price_cents")
      .eq("is_active", true)
      .order("price_cents", { ascending: true })
      .returns<
        {
          id: string;
          plan_code: string;
          name: string;
          monthly_credit_count: number;
          price_cents: number;
        }[]
      >(),
    supabase
      .from("site_faqs")
      .select("id, question_ar, question_en, answer_ar, answer_en")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .returns<Faq[]>(),
  ]);

  const { data, error } = plansRes;
  if (error) {
    logError("pricing: subscription_plans fetch failed", error, { tag: "pricing" });
  }
  if (faqsRes.error) {
    // Fail-soft: the policy-driven FAQ entries still render without DB rows.
    logError("pricing: site_faqs fetch failed", faqsRes.error, { tag: "pricing" });
  }
  // Explicit error branch (not `?? []`) so the silent-fail tripwire sees the
  // error is handled above, not defaulted away.
  const faqRows = faqsRes.error || !faqsRes.data ? [] : faqsRes.data;

  // Spec 038 — prepaid-hour wallet server-side gate. When the flag is OFF the
  // whole pay-as-you-go surface stays invisible (`prepaid` = null) and the
  // base disambiguator line is preserved. When ON, all four money knobs are
  // parsed defensively; the route re-validates server-side too, so a stale
  // client cache here cannot desync the charge.
  //
  // Read via getSettings() (admin-client bulk read), NOT isFeatureEnabled/
  // getSetting: /pricing is PUBLIC, and platform_settings RLS grants SELECT to
  // `authenticated` only — a user-scoped read runs as `anon` and fails closed,
  // so the card would never show to logged-out visitors. getSettings() is the
  // same anon-safe path the (public) layout already uses for hide_prices /
  // courses_enabled; the values are non-sensitive public toggles.
  const settings = await getSettings();
  let prepaid: PrepaidConfig | null = null;
  if (settings["prepaid_hours_purchase_enabled"] === "true") {
    const rateUsd = parseRate(settings["prepaid_hours_rate_usd"] ?? null);
    const presets = parsePresets(settings["prepaid_hours_preset_sizes"] ?? null);
    const minRawN = parseBound(settings["prepaid_hours_custom_min"] ?? null, DEFAULT_CUSTOM_MIN);
    const maxRawN = parseBound(settings["prepaid_hours_custom_max"] ?? null, DEFAULT_CUSTOM_MAX);
    const min = Math.min(minRawN, maxRawN);
    const max = Math.max(minRawN, maxRawN);
    prepaid = { rateUsd, presets, min, max };
  }

  // Spec 039 Phase 2c — PayPal button on the prepaid-hours card. Same anon-safe
  // getSettings() bulk read as `prepaid` above (NOT isFeatureEnabled/getSetting —
  // those are RLS-scoped to `authenticated` and would hide the button from
  // logged-out visitors, the exact bug that was fixed for the prepaid flag).
  // Default OFF: missing/blank/non-'true' → false → button stays invisible.
  const paypalEnabled = settings["paypal_purchase_enabled"] === "true";

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "الرئيسية", url: BASE_URL },
          { name: "الأسعار", url: `${BASE_URL}/pricing` },
        ]}
      />
      <PricingContent
        plans={data ?? []}
        faqs={faqRows}
        prepaid={prepaid}
        paypalEnabled={paypalEnabled}
        isAuthenticated={treatAsAuthenticated}
        track={track}
      />
    </>
  );
}
