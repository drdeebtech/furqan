"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createTeacher(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const teacherId = formData.get("teacher_id") as string;
  if (!teacherId) redirect("/admin/teachers");

  // Check if teacher_profiles already exists
  const { data: existing } = await supabase
    .from("teacher_profiles")
    .select("teacher_id")
    .eq("teacher_id", teacherId)
    .single();

  // Collect from checkboxes (multiple values with same name)
  const specialties = formData.getAll("specialties") as string[];
  const recitationStandards = formData.getAll("recitation_standards") as string[];

  const row = {
    teacher_id: teacherId,
    bio: (formData.get("bio") as string) || null,
    bio_en: (formData.get("bio_en") as string) || null,
    specialties: specialties.filter(Boolean),
    hourly_rate: Number(formData.get("hourly_rate")) || 20,
    gender: (formData.get("gender") as string) || null,
    languages: ((formData.get("languages") as string) || "ar").split(",").filter(Boolean),
    recitation_standards: recitationStandards.length > 0 ? recitationStandards.filter(Boolean) : ["hafs"],
  };

  if (existing) {
    // Update existing teacher profile
    await supabase.from("teacher_profiles").update(row as never).eq("teacher_id", teacherId);
  } else {
    // Create new teacher profile
    const { error } = await supabase.from("teacher_profiles").insert(row as never);
    if (error) {
      // If insert fails, don't proceed
      redirect("/admin/teachers");
    }
  }

  // Update profile role to teacher
  await supabase.from("profiles").update({ role: "teacher" } as never).eq("id", teacherId);

  revalidatePath("/admin/teachers");
  revalidatePath("/admin/users");
  redirect("/admin/teachers");
}

export async function updateTeacher(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const teacherId = formData.get("teacher_id") as string;

  const specialties = formData.getAll("specialties") as string[];
  const recitationStandards = formData.getAll("recitation_standards") as string[];

  await supabase.from("teacher_profiles").update({
    bio: (formData.get("bio") as string) || null,
    bio_en: (formData.get("bio_en") as string) || null,
    specialties: specialties.filter(Boolean),
    hourly_rate: Number(formData.get("hourly_rate")) || 20,
    gender: (formData.get("gender") as string) || null,
    languages: ((formData.get("languages") as string) || "ar").split(",").filter(Boolean),
    recitation_standards: recitationStandards.length > 0 ? recitationStandards.filter(Boolean) : ["hafs"],
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
