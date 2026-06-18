import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyAssignment } from "@/lib/domains/scheduling/assignments";
import { logError } from "@/lib/logger";

/**
 * GET /api/scheduling/my-assignment — fetch current student's active assignment.
 * Auth required. Returns 200 { assignment: Assignment | null }.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const assignment = await getMyAssignment(supabase, user.id);
    return NextResponse.json({ assignment });
  } catch (err) {
    logError("api/scheduling/my-assignment: failed", err, {
      tag: "scheduling",
      user_id: user.id,
    });
    return NextResponse.json({ error: "Failed to fetch assignment" }, { status: 500 });
  }
}
