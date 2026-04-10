import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { activateWorkflow, deactivateWorkflow } from "@/lib/n8n/client";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single<{ role: string }>();
  if (!profile || profile.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, active } = await request.json();
  if (!id) return NextResponse.json({ error: "Missing workflow id" }, { status: 400 });

  try {
    if (active) {
      await activateWorkflow(id);
    } else {
      await deactivateWorkflow(id);
    }
    return NextResponse.json({ success: true, id, active });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
