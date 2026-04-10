import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getExecutionDetail } from "@/lib/n8n/client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { id } = await params;
    const execution = await getExecutionDetail(id);
    return NextResponse.json(execution);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
