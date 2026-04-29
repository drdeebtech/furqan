"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";

/**
 * Manually run the retention scorer (same endpoint n8n calls on its daily cron).
 * Hits the internal API server-to-server with the shared secret.
 */
export async function runScorerNow(): Promise<{ ok: boolean; scored?: number; high_risk?: number; error?: string }> {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "غير مصرح" };
    throw e;
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) return { ok: false, error: "N8N_WEBHOOK_SECRET غير مضبوط" };

  try {
    const res = await fetch(`${base}/api/retention/score`, {
      method: "POST",
      headers: { "X-N8N-Secret": secret, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error ?? `HTTP ${res.status}` };
    revalidatePath("/admin/retention");
    revalidatePath("/admin/control-tower");
    return { ok: true, scored: json.scored, high_risk: json.high_risk };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل التشغيل" };
  }
}
