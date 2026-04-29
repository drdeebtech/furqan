import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { getWorkflowDetail } from "@/lib/n8n/client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  try {
    const { id } = await params;
    const workflow = await getWorkflowDetail(id);
    return NextResponse.json(workflow);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
