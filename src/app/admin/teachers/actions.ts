"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";

export async function createTeacher(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const teacherId = formData.get("teacher_id") as string;
  if (!teacherId) redirect("/admin/teachers?error=missing_teacher_id");

  const { data: existing } = await supabase
    .from("teacher_profiles")
    .select("teacher_id")
    .eq("teacher_id", teacherId)
    .single();

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
    const { error } = await supabase.from("teacher_profiles").update(row as never).eq("teacher_id", teacherId);
    if (error) {
      logError("admin.createTeacher: update failed", error, { tag: "admin-teachers" });
      redirect(`/admin/teachers?error=${encodeURIComponent("فشل تحديث الملف: " + error.message)}`);
    }
  } else {
    const { error } = await supabase.from("teacher_profiles").insert(row as never);
    if (error) {
      logError("admin.createTeacher: insert failed", error, { tag: "admin-teachers" });
      redirect(`/admin/teachers?error=${encodeURIComponent("فشل إنشاء الملف: " + error.message)}`);
    }
  }

  const { error: roleError } = await supabase
    .from("profiles")
    .update({ role: "teacher" } as never)
    .eq("id", teacherId);
  if (roleError) {
    logError("admin.createTeacher: role update failed", roleError, { tag: "admin-teachers" });
    redirect(`/admin/teachers?error=${encodeURIComponent("تم إنشاء الملف لكن فشل تحديث الدور: " + roleError.message)}`);
  }

  revalidatePath("/admin/teachers");
  revalidatePath("/admin/users");
  redirect("/admin/teachers?success=created");
}

export async function updateTeacher(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const teacherId = formData.get("teacher_id") as string;

  const specialties = formData.getAll("specialties") as string[];
  const recitationStandards = formData.getAll("recitation_standards") as string[];

  const { error } = await supabase.from("teacher_profiles").update({
    bio: (formData.get("bio") as string) || null,
    bio_en: (formData.get("bio_en") as string) || null,
    specialties: specialties.filter(Boolean),
    hourly_rate: Number(formData.get("hourly_rate")) || 20,
    gender: (formData.get("gender") as string) || null,
    languages: ((formData.get("languages") as string) || "ar").split(",").filter(Boolean),
    recitation_standards: recitationStandards.length > 0 ? recitationStandards.filter(Boolean) : ["hafs"],
    is_accepting: formData.has("is_accepting"),
  } as never).eq("teacher_id", teacherId);
  if (error) {
    logError("admin.updateTeacher failed", error, { tag: "admin-teachers" });
    redirect(`/admin/teachers?error=${encodeURIComponent("فشل التحديث: " + error.message)}`);
  }

  revalidatePath("/admin/teachers");
  redirect("/admin/teachers?success=updated");
}

export async function verifyIjaza(ijazaId: string, adminId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("teacher_ijaza").update({
    verified_by: adminId,
    verified_at: new Date().toISOString(),
  } as never).eq("id", ijazaId);
  if (error) {
    logError("admin.verifyIjaza failed", error, { tag: "admin-teachers" });
    return { success: false, error: error.message };
  }
  revalidatePath("/admin/teachers");
  return { success: true };
}
