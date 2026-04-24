import "server-only";
import { createClient } from "@/lib/supabase/server";

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requireAdmin(): Promise<{ id: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ForbiddenError("not authenticated");

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string | null }>();

  if (data?.role !== "admin") throw new ForbiddenError("not admin");
  return { id: user.id };
}
