import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { BreadcrumbSchema } from "@/components/seo/structured-data";
import { BASE_URL } from "@/lib/constants";
import { logError } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import { PricingContent, type Faq, type PrepaidConfig } from "./content";

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

const DEFAULT_RATE_USD = 10;
const DEFAULT_PRESETS = [5, 10, 20];
const DEFAULT_CUSTOM_MIN = 1;
const DEFAULT_CUSTOM_MAX = 100;

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

export default async function PricingPage() {
  const supabase = await createClient();

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

  return (
    <>
      <BreadcrumbSchema
        items={[
          { name: "الرئيسية", url: BASE_URL },
          { name: "الأسعار", url: `${BASE_URL}/pricing` },
        ]}
      />
      <PricingContent plans={data ?? []} faqs={faqRows} prepaid={prepaid} />
    </>
  );
}
