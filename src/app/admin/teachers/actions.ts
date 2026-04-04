"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createTeacher(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const teacherId = formData.get("teacher_id") as string;
  await supabase.from("teacher_profiles").insert({
    teacher_id: teacherId,
    bio: formData.get("bio") as string || null,
    specialties: (formData.get("specialties") as string).split(",").filter(Boolean),
    hourly_rate: Number(formData.get("hourly_rate")),
    gender: formData.get("gender") as string || null,
    languages: (formData.get("languages") as string).split(",").filter(Boolean),
    recitation_standards: (formData.get("recitation_standards") as string).split(",").filter(Boolean),
  } as never);

  // Update profile role to teacher
  await supabase.from("profiles").update({ role: "teacher" } as never).eq("id", teacherId);

  revalidatePath("/admin/teachers");
  redirect("/admin/teachers");
}

export async function updateTeacher(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const teacherId = formData.get("teacher_id") as string;
  await supabase.from("teacher_profiles").update({
    bio: formData.get("bio") as string || null,
    specialties: (formData.get("specialties") as string).split(",").filter(Boolean),
    hourly_rate: Number(formData.get("hourly_rate")),
    gender: formData.get("gender") as string || null,
    languages: (formData.get("languages") as string).split(",").filter(Boolean),
    recitation_standards: (formData.get("recitation_standards") as string).split(",").filter(Boolean),
    is_accepting: formData.has("is_accepting"),
  } as never).eq("teacher_id", teacherId);

  revalidatePath("/admin/teachers");
  redirect("/admin/teachers");
}

export async function verifyIjaza(ijazaId: string, adminId: string) {
  const supabase = await createClient();
  await supabase.from("teacher_ijaza").update({
    verified_by: adminId,
    verified_at: new Date().toISOString(),
  } as never).eq("id", ijazaId);
  revalidatePath("/admin/teachers");
  return { success: true };
}
