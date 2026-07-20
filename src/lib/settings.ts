import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFlag } from "@/lib/edge-config";
import type { PlatformSetting } from "@/types/database";

export const ALLOWED_SETTING_KEYS = [
  "hide_reviews",
  "hide_prices",
  "hide_teachers_page",
  "retention_ui_disabled",
  "automation_enabled",
  "whatsapp_enabled",
  "ai_parent_reports_enabled",
  "teacher_quality_monitor_enabled",
  "retention_automation_enabled",
  "renewal_campaigns_enabled",
  "supported_currencies",
  "courses_enabled",
  "paid_courses_enabled",
  "paypal_purchase_enabled",
  // Spec 038 — pay-as-you-go prepaid hours. Gates the PrepaidCard on /pricing
  // (server-side); without it BOTH the card's card-payment and PayPal buttons
  // are unreachable, so the whole prepaid rail is invisible regardless of
  // paypal_purchase_enabled. Was never in this allowlist, so it had no admin
  // toggle and no way to be turned on short of raw SQL.
  "prepaid_hours_purchase_enabled",
  "hifz_individual_hourly_rate_usd",
  "hifz_group_4_price_usd",
  "hifz_group_6_price_usd",
  "hifz_group_8_price_usd",
  "hifz_second_individual_discount_pct",
  "hifz_sibling_group_discount_pct",
  "hifz_assessment_price_usd",
  "hifz_assessment_limit_per_specialty",
  // Spec 021 — attendance & payroll tuning knobs.
  "excuse_notice_threshold_seconds", // default 7200 (2h); minimum notice for an eligible excuse
  "payroll_run_day_of_month",        // default 1; day of month the monthly payout run fires
  // Spec 023 — reports/gamification/notifications tuning knobs.
  "honor_board_refresh_cadence_days",     // default 7; days between honor-board recomputes
  "notifications_whatsapp_enabled",       // default 'true'; global WhatsApp feature flag (per-trigger matrix still applies)
  "notification_channel_matrix",          // JSON map trigger → channel[]; overrides FR-012 defaults
  "subscription_expiring_lead_days",      // default 7; days before period end the "continue?" prompt fires (CHK015)
  // ── Spec 022 (م٥): one-time-paid single-session products ───────────────
  // Prices are stored as decimal USD strings ('0.00' seed = free-by-default
  // until an admin sets a real price). Assessment zero = free booking.
  "single_session_instant_price_usd",
  "single_session_assessment_price_usd",
  "single_session_review_price_usd",
  "single_session_consolidate_surah_price_usd",
  "single_session_memorize_mutoon_price_usd",
  "single_session_test_juz_price_usd",
] as const;

export type AllowedSettingKey = (typeof ALLOWED_SETTING_KEYS)[number];

export function isAllowedSettingKey(key: string): key is AllowedSettingKey {
  return (ALLOWED_SETTING_KEYS as readonly string[]).includes(key);
}

export const getSettings = unstable_cache(
  async (): Promise<Record<string, string>> => {
    // Admin client (no cookies()) — required because unstable_cache disallows
    // dynamic APIs inside the cached function body.
    // admin: inside unstable_cache (cookies disallowed); reads platform_settings (issue #523)
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("platform_settings")
      .select("key, value")
      .returns<Pick<PlatformSetting, "key" | "value">[]>();

    if (!data) return {};
    return Object.fromEntries(data.map((s) => [s.key, s.value]));
  },
  ["platform-settings"],
  { tags: ["platform-settings"], revalidate: 3600 },
);

export async function getSetting(key: string): Promise<string | null> {
  // Edge Config fast-path — sub-1ms global read when EDGE_CONFIG is
  // provisioned and the key is mirrored to the store. Returns null on
  // every miss path (env unset, key absent, transient EC outage), so
  // we always have a Postgres safety net below.
  const cached = await getFlag(key);
  if (cached !== null) return cached;

  const supabase = await createClient();
  // maybeSingle() — a missing key (e.g. paypal_purchase_enabled before
  // an admin toggles it) is a valid "not configured" state, not an error.
  // .single() raises PGRST116 on 0 rows and surfaced on every /packages
  // load. (Sentry JAVASCRIPT-NEXTJS-E4-1F.)
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle<{ value: string }>();

  return data?.value ?? null;
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const value = await getSetting(key);
  return value === "true";
}
