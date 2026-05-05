"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";

/**
 * Public-surface paths whose cached output should be busted on a cache-clear.
 * Order matters only insofar as we report it back to the caller; revalidation
 * is per-path and idempotent.
 *
 * NOTE: this is *narrower* than `revalidatePath("/")` because that hits every
 * cached page including admin OG images and dashboards. We only bust the
 * public marketing surfaces where stale content is most user-visible.
 */
const PUBLIC_PATHS = [
  "/",
  "/teach-with-us",
  "/teachers",
  "/packages",
  "/services",
  "/blog",
  "/about",
  "/contact",
  "/terms",
  "/privacy",
] as const;

export interface CacheClearResult {
  success: boolean;
  paths: number;
  triggeredBy: "manual" | "cron";
  at: string;
  error?: string;
}

/**
 * Bust the public-surface cache. Used by:
 *   - the admin "Clear cache" button (admin auth required)
 *   - the /api/cron/cache-clear endpoint (N8N_WEBHOOK_SECRET required)
 *
 * The `triggeredBy` arg distinguishes the two callers for logging.
 */
export async function clearPublicCache(triggeredBy: "manual" | "cron" = "manual"): Promise<CacheClearResult> {
  if (triggeredBy === "manual") {
    try {
      await requireAdmin();
    } catch (e) {
      if (e instanceof ForbiddenError) {
        return { success: false, paths: 0, triggeredBy, at: new Date().toISOString(), error: "ليس لديك صلاحية" };
      }
      throw e;
    }
  }

  for (const path of PUBLIC_PATHS) {
    revalidatePath(path);
  }

  return {
    success: true,
    paths: PUBLIC_PATHS.length,
    triggeredBy,
    at: new Date().toISOString(),
  };
}
