import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { loadControlTowerSnapshot } from "@/app/admin/control-tower/data";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Polled every 30s by `<ControlTowerGrid>` to keep widget counts fresh on
 * both desktop and the mobile remote-session view. Returns the same shape
 * the page server-renders on first paint.
 */
export async function GET() {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  try {
    const snapshot = await loadControlTowerSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    logError("control-tower snapshot failed", err, { tag: "control-tower" });
    return NextResponse.json({ error: "snapshot failed" }, { status: 500 });
  }
}
