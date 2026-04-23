import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { sendSessionNarrative } from "@/lib/reports/send-narrative";

export const maxDuration = 60;

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * POST: Generate and send the parent session narrative.
 *
 * Body (optional):
 *   { narrative_paragraph?: string }  // AI-generated override from n8n
 *
 * Auth:
 *   - X-N8N-Secret for server-to-server (actor is the service)
 *   - Cookie session for admin/moderator (actor is the logged-in user)
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const n8nSecret = request.headers.get("X-N8N-Secret");
  const hasN8nSecret = safeCompare(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  let actorId: string;
  if (hasN8nSecret) {
    actorId = "00000000-0000-0000-0000-000000000000"; // service actor
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: actor } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role: string }>();
    if (!actor || !["admin", "moderator"].includes(actor.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    actorId = user.id;
  }

  let narrativeOverride: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.narrative_paragraph === "string") {
      narrativeOverride = body.narrative_paragraph;
    }
  } catch {
    // no body is fine — we use the template
  }

  const result = await sendSessionNarrative({ sessionId: id, actorId, narrativeOverride });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
