"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";

async function authOrError(): Promise<{ id?: string; error?: string }> {
  try {
    return { id: (await requireAdmin()).id };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "ليس لديك صلاحية" };
    throw e;
  }
}

export async function toggleUserActive(userId: string, isActive: boolean) {
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  // Fetch existing for audit
  const { data: existing } = await admin
    .from("profiles")
    .select("is_active")
    .eq("id", userId)
    .single<{ is_active: boolean }>();

  const { error } = await admin.from("profiles").update({ is_active: isActive } as never).eq("id", userId);
  if (error) return { error: "فشل تحديث حالة المستخدم" };

  await admin.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "UPDATE",
    old_data: { is_active: existing?.is_active ?? null },
    new_data: { is_active: isActive },
    reason: isActive ? "Admin reactivated user" : "Admin deactivated user",
  } as never);

  revalidatePath("/admin/users");
  return { success: true };
}

export async function changeUserRole(userId: string, role: string) {
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single<{ role: string }>();

  const { error } = await admin.from("profiles").update({ role } as never).eq("id", userId);
  if (error) return { error: "فشل تغيير الدور — تأكد من صلاحيات المدير" };

  await admin.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "UPDATE",
    old_data: { role: existing?.role ?? null },
    new_data: { role },
    reason: `Admin changed role: ${existing?.role ?? "unknown"} → ${role}`,
  } as never);

  if (role === "teacher") {
    const { data: teacherProfile } = await admin
      .from("teacher_profiles")
      .select("teacher_id")
      .eq("teacher_id", userId)
      .single();

    if (!teacherProfile) {
      await admin.from("teacher_profiles").insert({
        teacher_id: userId,
        specialties: [],
        hourly_rate: 20,
        languages: ["ar"],
        recitation_standards: ["hafs"],
      } as never);
    }
  }

  if (role !== "teacher") {
    await admin.from("teacher_profiles").update({
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
  const auth = await authOrError();
  if (auth.error) return { error: auth.error };

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

  if (role === "teacher") {
    await adminClient.from("teacher_profiles").insert({
      teacher_id: userId,
      specialties: [],
      hourly_rate: 20,
      languages: ["ar"],
      recitation_standards: ["hafs"],
    } as never);
  }

  await adminClient.from("audit_log").insert({
    changed_by: auth.id,
    table_name: "profiles",
    record_id: userId,
    action: "INSERT",
    old_data: null,
    new_data: { email, role, full_name, country },
    reason: `Admin created ${role} account`,
  } as never);

  revalidatePath("/admin/users");
  return { success: true };
}
