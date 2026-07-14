import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase.generated";

export async function canReadStudent(
  supabase: SupabaseClient<Database>,
  viewerId: string,
  studentId: string,
): Promise<boolean> {
  if (viewerId === studentId) return true;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", viewerId)
    .maybeSingle<{ role: string | null }>();
  if (profileError) return false;
  if (profile?.role === "admin") return true;

  const { data: guardianLink, error: guardianError } = await supabase
    .from("guardian_children")
    .select("guardian_id")
    .eq("guardian_id", viewerId)
    .eq("child_id", studentId)
    .maybeSingle<{ guardian_id: string }>();
  if (guardianError) return false;
  if (guardianLink) return true;

  const { data: teacherLink, error: teacherError } = await supabase
    .from("bookings")
    .select("id")
    .eq("teacher_id", viewerId)
    .eq("student_id", studentId)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (teacherError) return false;

  return Boolean(teacherLink);
}
