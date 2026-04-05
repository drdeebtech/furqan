"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function toggleUserActive(userId: string, isActive: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ is_active: isActive } as never).eq("id", userId);
  if (error) return { error: "فشل تحديث حالة المستخدم" };
  revalidatePath("/admin/users");
  return { success: true };
}

export async function changeUserRole(userId: string, role: string) {
  const supabase = await createClient();

  // Update the profile role
  const { error } = await supabase.from("profiles").update({ role } as never).eq("id", userId);
  if (error) return { error: "فشل تغيير الدور — تأكد من صلاحيات المدير" };

  // If changing TO teacher, create teacher_profiles row if it doesn't exist
  if (role === "teacher") {
    const { data: existing } = await supabase
      .from("teacher_profiles")
      .select("teacher_id")
      .eq("teacher_id", userId)
      .single();

    if (!existing) {
      await supabase.from("teacher_profiles").insert({
        teacher_id: userId,
        specialties: [],
        hourly_rate: 20,
        languages: ["ar"],
        recitation_standards: ["hafs"],
      } as never);
    }
  }

  // If changing FROM teacher, archive the teacher profile
  if (role !== "teacher") {
    await supabase.from("teacher_profiles").update({
      is_archived: true,
      archived_at: new Date().toISOString(),
    } as never).eq("teacher_id", userId);
  }

  revalidatePath("/admin/users");
  revalidatePath("/admin/teachers");
  return { success: true };
}

export async function createUserFromScratch(
  _prev: { success?: boolean; error?: string },
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const full_name = formData.get("full_name") as string;
  const role = formData.get("role") as string;
  const phone = (formData.get("phone") as string) || null;
  const country = (formData.get("country") as string) || null;
  const parent_name = (formData.get("parent_name") as string) || null;
  const parent_phone = (formData.get("parent_phone") as string) || null;
  const parent_email = (formData.get("parent_email") as string) || null;
  const date_of_birth = (formData.get("date_of_birth") as string) || null;

  if (!email || !password || !full_name || !role) {
    return { error: "جميع الحقول المطلوبة يجب ملؤها" };
  }

  if (!["student", "teacher", "moderator"].includes(role)) {
    return { error: "دور غير صالح" };
  }

  if (password.length < 8) {
    return { error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" };
  }

  const adminClient = createAdminClient();

  // Create the auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (authError || !authData.user) {
    if (authError?.message?.includes("already been registered")) {
      return { error: "البريد الإلكتروني مسجل بالفعل" };
    }
    return { error: authError?.message ?? "فشل إنشاء المستخدم" };
  }

  const userId = authData.user.id;

  // Update the profile with role and optional fields
  const { error: profileError } = await adminClient.from("profiles").update({
    role,
    full_name,
    phone,
    country,
    parent_name,
    parent_phone,
    parent_email,
    date_of_birth,
  } as never).eq("id", userId);

  if (profileError) {
    return { error: "تم إنشاء المستخدم لكن فشل تحديث الملف الشخصي" };
  }

  // If teacher, create teacher_profiles row
  if (role === "teacher") {
    await adminClient.from("teacher_profiles").insert({
      teacher_id: userId,
      specialties: [],
      hourly_rate: 20,
      languages: ["ar"],
      recitation_standards: ["hafs"],
    } as never);
  }

  revalidatePath("/admin/users");
  return { success: true };
}
