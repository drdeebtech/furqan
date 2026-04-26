import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
