import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { getExecutionDetail } from "@/lib/n8n/client";
import { logError } from "@/lib/logger";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = await params;
    const execution = await getExecutionDetail(id);
    return NextResponse.json(execution);
  } catch (err) {
    logError("n8n execution detail fetch failed", err, { tag: "n8n-execution" });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
