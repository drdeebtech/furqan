import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { buildSessionNarrative } from "@/lib/reports/session-narrative";

export const maxDuration = 60;

function safeCompare(a: string | null, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Return a structured parent-facing session narrative.
 *
 * Access:
 *   - Server-to-server (n8n): header X-N8N-Secret must match N8N_WEBHOOK_SECRET
 *   - Logged-in admin/moderator/teacher: via cookie session
 *
 * Today this is the fallback path; Sprint 8 wires AI generation into the same
 * shape by swapping narrative_paragraph server-side.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Server-to-server path
  const n8nSecret = request.headers.get("X-N8N-Secret");
  const hasN8nSecret = safeCompare(n8nSecret, process.env.N8N_WEBHOOK_SECRET);

  if (!hasN8nSecret) {
    // Fall back to cookie-based auth
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: actor } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<{ role: string }>();
    if (!actor || !["admin", "moderator", "teacher"].includes(actor.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  const narrative = await buildSessionNarrative(id);
  if (!narrative) {
    return NextResponse.json({ error: "Session not found or not completed" }, { status: 404 });
  }

  return NextResponse.json(narrative);
}
