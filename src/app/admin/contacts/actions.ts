"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function markAsRead(submissionId: string) {
  const supabase = await createClient();
  // as never: Supabase-generated types don't match runtime schema; safe workaround
  await supabase.from("contact_submissions").update({ is_read: true } as never).eq("id", submissionId);
  revalidatePath("/admin/contacts");
  return { success: true };
}
