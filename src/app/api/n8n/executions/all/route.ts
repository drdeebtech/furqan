import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { getAllExecutions } from "@/lib/n8n/client";

export async function GET() {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  try {
    const result = await getAllExecutions();
    return NextResponse.json({ data: result.data, nextCursor: result.nextCursor });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
