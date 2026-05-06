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
] as const;

export type AllowedSettingKey = (typeof ALLOWED_SETTING_KEYS)[number];

export function isAllowedSettingKey(key: string): key is AllowedSettingKey {
  return (ALLOWED_SETTING_KEYS as readonly string[]).includes(key);
}

export const getSettings = unstable_cache(
  async (): Promise<Record<string, string>> => {
    // Admin client (no cookies()) — required because unstable_cache disallows
    // dynamic APIs inside the cached function body.
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
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", key)
    .single<{ value: string }>();

  return data?.value ?? null;
}

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const value = await getSetting(key);
  return value === "true";
}
