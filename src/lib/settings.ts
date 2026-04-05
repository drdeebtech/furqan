"use server";

import { createClient } from "@/lib/supabase/server";
import type { PlatformSetting } from "@/types/database";

/**
 * Get all platform settings as a key-value map.
 */
export async function getSettings(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("key, value")
    .returns<Pick<PlatformSetting, "key" | "value">[]>();

  if (!data) return {};
  return Object.fromEntries(data.map((s) => [s.key, s.value]));
}

/**
 * Get a single setting value. Returns null if not found.
 */
export async function getSetting(key: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", key)
    .single<{ value: string }>();

  return data?.value ?? null;
}

/**
 * Check if a boolean setting is true (convenience for feature flags).
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  const value = await getSetting(key);
  return value === "true";
}
