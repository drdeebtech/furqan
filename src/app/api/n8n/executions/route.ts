import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { getExecutions } from "@/lib/n8n/client";

export const maxDuration = 30;

export async function GET() {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  try {
    const executions = await getExecutions(50);
    return NextResponse.json({ data: executions });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
