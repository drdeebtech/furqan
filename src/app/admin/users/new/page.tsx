import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreateUserForm } from "./create-user-form";

export const metadata: Metadata = { title: "إنشاء مستخدم جديد" };

export default async function CreateUserPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <CreateUserForm />;
}
