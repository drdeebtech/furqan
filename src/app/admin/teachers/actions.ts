"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { invalidateByTag } from "@vercel/functions";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { invalidateRoleCache } from "@/lib/auth/role-cache";
import { logError } from "@/lib/logger";
import type { TableInsert } from "@/lib/supabase/typed-helpers";

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

  const row: TableInsert<"teacher_profiles"> = {
    teacher_id: teacherId,
    bio: (formData.get("bio") as string) || null,
    bio_en: (formData.get("bio_en") as string) || null,
    specialties: specialties.filter(Boolean),
    hourly_rate: Number(formData.get("hourly_rate")) || 20,
    // FormData arrives untyped; column is the gender_type enum.
    // Same precedent as PR #181 (updateTeacher path).
    gender: ((formData.get("gender") as string) || null) as "male" | "female" | null,
    // Languages now come from a checkbox group (formData.getAll). Fallback
    // to ["ar"] only if nothing was checked, preserving the prior default.
    languages: (() => {
      const picked = (formData.getAll("languages") as string[]).filter(Boolean);
      return picked.length > 0 ? picked : ["ar"];
    })(),
    recitation_standards: recitationStandards.length > 0 ? recitationStandards.filter(Boolean) : ["hafs"],
  };

  if (existing) {
    const { error } = await supabase.from("teacher_profiles").update(row).eq("teacher_id", teacherId);
    if (error) {
      logError("admin.createTeacher: update failed", error, { tag: "admin-teachers" });
      redirect(`/admin/teachers?error=${encodeURIComponent("فشل تحديث الملف: " + error.message)}`);
    }
  } else {
    const { error } = await supabase.from("teacher_profiles").insert(row);
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

  // Promoted to teacher — flush the per-user role cache so middleware
  // doesn't keep them as "student" for up to the 10s TTL fallback.
  invalidateRoleCache(teacherId);

  revalidatePath("/admin/teachers");
  revalidatePath("/admin/users");
  revalidatePath("/teachers"); // public list now ISR-cached (300s) — invalidate on create
  revalidateTag("teachers-public", "max"); // Next.js Data Cache (unstable_cache wrap on /teachers)
  await invalidateByTag("teachers-public"); // CDN edge cache (active once layout becomes cookie-free)
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
    // Languages now come from a checkbox group (formData.getAll). Fallback
    // to ["ar"] only if nothing was checked, preserving the prior default.
    languages: (() => {
      const picked = (formData.getAll("languages") as string[]).filter(Boolean);
      return picked.length > 0 ? picked : ["ar"];
    })(),
    recitation_standards: recitationStandards.length > 0 ? recitationStandards.filter(Boolean) : ["hafs"],
    is_accepting: formData.has("is_accepting"),
  } as never).eq("teacher_id", teacherId);
  if (error) {
    logError("admin.updateTeacher failed", error, { tag: "admin-teachers" });
    redirect(`/admin/teachers?error=${encodeURIComponent("فشل التحديث: " + error.message)}`);
  }

  revalidatePath("/admin/teachers");
  revalidatePath("/teachers"); // updates bio/rate/is_accepting — public-page-visible
  revalidateTag("teachers-public", "max"); // Next.js Data Cache (unstable_cache wrap on /teachers)
  await invalidateByTag("teachers-public"); // CDN edge cache (active once layout becomes cookie-free)
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
