import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { logError, logInfo } from "@/lib/logger";

export const maxDuration = 30;

const PRICE_KEYS = [
  "single_session_instant_price_usd",
  "single_session_assessment_price_usd",
  "single_session_review_price_usd",
  "single_session_consolidate_surah_price_usd",
  "single_session_memorize_mutoon_price_usd",
  "single_session_test_juz_price_usd",
] as const;

const UpdatePriceSchema = z.object({
  key: z.enum(PRICE_KEYS),
  value: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Must be a non-negative decimal USD amount (e.g. 5 or 5.00)"),
});

/**
 * POST /api/admin/single-sessions/prices
 *
 * Spec 022 US4: an admin updates any single-session price. Next booking
 * charges the updated amount (SC-006). Auth requires `private.is_admin()`
 * via `requireAdminForApi`; non-admin → 403. All writes go through the
 * service-role client — financial writes are service-role only.
 *
 * The price is stored as a decimal USD string. `revalidateTag('platform-settings')`
 * flushes the cache so the next `getSetting(...)` reflects the new value.
 */
export async function POST(request: Request) {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  let parsed: z.infer<typeof UpdatePriceSchema>;
  try {
    parsed = UpdatePriceSchema.parse(await request.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid body", issues: e.flatten() },
        { status: 400 },
      );
    }
    throw e;
  }

  const admin = createAdminClient();

  // UPDATE — the row is seeded by migration; we only ever change `value`.
  // Service-role write (financial writes are service-role only).
  const { data, error } = await admin
    .from("platform_settings")
    .update({ value: parsed.value, updated_by: guard.id })
    .eq("key", parsed.key)
    .select("key, value")
    .maybeSingle<{ key: string; value: string }>();

  if (error || !data) {
    logError("admin single-sessions prices: update failed", error ?? new Error("no row"), {
      tag: "single-sessions",
      key: parsed.key,
    });
    return NextResponse.json({ error: "Failed to update price" }, { status: 500 });
  }

  // Flush the settings cache so the next booking reads the new price.
  revalidateTag("platform-settings", "max");

  logInfo("single-session price updated", {
    tag: "single-sessions",
    key: parsed.key,
    admin_id: guard.id,
  });

  return NextResponse.json({ success: true, data: { key: data.key, value: data.value } });
}
