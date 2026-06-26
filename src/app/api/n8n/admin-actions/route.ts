import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  try {
    // admin: admin-gated; reads automation_logs telemetry (issue #523)
    const admin = createAdminClient();
    const { data: rows, error } = await admin
      .from("automation_logs")
      .select("*")
      .like("event_name", "admin.%")
      .order("started_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    return NextResponse.json({ data: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
