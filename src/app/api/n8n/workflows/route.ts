import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { getWorkflows } from "@/lib/n8n/client";

export const maxDuration = 30;

export async function GET() {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  try {
    const workflows = await getWorkflows();
    return NextResponse.json({ data: workflows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
