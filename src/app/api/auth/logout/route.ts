import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/logger";

export async function POST() {
  const supabase = await createClient();

  // Audit the sign-out BEFORE signOut() destroys the session — otherwise
  // we can't read user.id afterward. Fire-and-forget per project convention.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const h = await headers();
      const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      const admin = createAdminClient();
      await admin.from("audit_log").insert({
        changed_by: user.id,
        table_name: "auth.users",
        record_id: user.id,
        action: "LOGOUT",
        old_data: null,
        new_data: { email: user.email ?? null },
        ip_address: ip,
        reason: "User signed out",
      } as never);
    }
  } catch (err) {
    logError("recordLogout failed (non-blocking)", err, { tag: "auth-audit" });
  }

  await supabase.auth.signOut();
  redirect("/login");
}
