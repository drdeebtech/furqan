import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
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
