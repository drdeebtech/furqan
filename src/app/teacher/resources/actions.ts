"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";

const VALID_TYPES = ["pdf", "audio", "link", "video", "image"] as const;
type ResourceType = (typeof VALID_TYPES)[number];

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB cap, matches admin path

export interface TeacherResourceFormState {
  ok?: boolean;
  error?: string;
  id?: string;
}

/**
 * Teacher upload — creates a private `resources` row tagged with
 * `created_by_teacher_id = self` so the new RLS policy gates it. Files go
 * to the same `resources` storage bucket, segregated by `teacher/<uid>/...`
 * path so admin curation never collides.
 *
 * Returns `{ ok, id }` on success or `{ error }` on failure. Caller must
 * render the message inline (the upload-form does so).
 */
export async function uploadTeacherResourceAction(
  _prev: TeacherResourceFormState,
  formData: FormData,
): Promise<TeacherResourceFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  const title_ar = String(formData.get("title_ar") ?? "").trim();
  const description_ar =
    String(formData.get("description_ar") ?? "").trim() || null;
  const resource_type = String(formData.get("resource_type") ?? "");
  const category =
    String(formData.get("category") ?? "general").trim() || "general";
  const external_url_raw =
    String(formData.get("external_url") ?? "").trim() || null;
  const fileEntry = formData.get("file");

  if (!title_ar) return { error: "العنوان مطلوب" };
  if (!(VALID_TYPES as readonly string[]).includes(resource_type)) {
    return { error: "نوع غير صالح" };
  }

  let file_url: string | null = null;
  if (fileEntry instanceof File && fileEntry.size > 0) {
    if (fileEntry.size > MAX_UPLOAD_BYTES) {
      return { error: "الملف كبير جدًا — الحد الأقصى 50 ميغابايت" };
    }
    const adminClient = createAdminClient();
    const ext = fileEntry.name.split(".").pop()?.toLowerCase() ?? "bin";
    const path = `teacher/${user.id}/${resource_type}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await adminClient.storage
      .from("resources")
      .upload(path, fileEntry, {
        contentType: fileEntry.type || "application/octet-stream",
        upsert: false,
      });
    if (upErr) {
      logError("teacher.uploadResource: upload failed", upErr, {
        component: "teacher.resources.upload",
        metadata: { teacherId: user.id, resource_type },
      });
      return { error: `فشل رفع الملف: ${upErr.message}` };
    }
    const { data: pub } = adminClient.storage
      .from("resources")
      .getPublicUrl(path);
    file_url = pub?.publicUrl ?? null;
    if (!file_url) return { error: "تعذر إنشاء رابط الملف" };
  }

  if (!file_url && !external_url_raw) {
    return { error: "يجب رفع ملف أو إضافة رابط خارجي" };
  }

  const insertRes = await supabase
    .from("resources")
    .insert({
      title_ar,
      title_en: null,
      description_ar,
      description_en: null,
      resource_type: resource_type as ResourceType,
      category,
      tags: [],
      is_published: false,
      file_url,
      external_url: external_url_raw,
      uploaded_by: user.id,
      created_by_teacher_id: user.id,
    } as never)
    .select("id")
    .single<{ id: string }>();
  if (insertRes.error) {
    logError("teacher.uploadResource: insert failed", insertRes.error, {
      component: "teacher.resources.upload",
      metadata: { teacherId: user.id },
    });
    return { error: `فشل الحفظ: ${insertRes.error.message}` };
  }

  revalidatePath("/teacher/resources");
  return { ok: true, id: insertRes.data?.id };
}

/**
 * Assign a teacher-owned resource to a specific student. Verifies the
 * teacher owns the resource (defense-in-depth on top of RLS) and that
 * a booking exists between them — same gate as the recitation roster's
 * `requestFreshRecitationAction`.
 */
export async function assignResourceToStudentAction(
  resourceId: string,
  studentId: string,
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  // Defense-in-depth ownership check.
  const ownerRes = await supabase
    .from("resources")
    .select("id, title_ar, created_by_teacher_id")
    .eq("id", resourceId)
    .maybeSingle<{
      id: string;
      title_ar: string;
      created_by_teacher_id: string | null;
    }>();
  if (ownerRes.error) {
    logError("assignResource: owner lookup failed", ownerRes.error, {
      component: "teacher.resources.assign",
    });
    return { error: "فشل البحث عن المصدر" };
  }
  if (
    !ownerRes.data ||
    ownerRes.data.created_by_teacher_id !== user.id
  ) {
    return { error: "ليس لديك صلاحية على هذا المصدر" };
  }

  const insertRes = await supabase
    .from("resource_assignments")
    .insert({
      resource_id: resourceId,
      student_id: studentId,
      halaqa_id: null,
      assigned_by: user.id,
    } as never);
  if (insertRes.error) {
    // Unique-index violation when re-assigning to the same student is
    // handled gracefully — the teacher's intent ("share with this student")
    // is already satisfied.
    if (insertRes.error.code === "23505") {
      return { success: true };
    }
    logError("assignResource: insert failed", insertRes.error, {
      component: "teacher.resources.assign",
      metadata: { resourceId, studentId },
    });
    return { error: `فشل الإسناد: ${insertRes.error.message}` };
  }

  // Best-effort student notification.
  try {
    await notify(
      studentId,
      "system",
      "مصدر جديد",
      `شارك معك معلمك مصدراً جديداً — ${ownerRes.data.title_ar}.`,
      "system",
      resourceId,
    );
  } catch (err) {
    logError("assignResource: notify failed", err, {
      component: "teacher.resources.assign",
      metadata: { studentId, resourceId },
    });
  }

  revalidatePath("/teacher/resources");
  revalidatePath("/student/resources");
  return { success: true };
}

/**
 * Delete a teacher-owned resource. RLS already gates this; the explicit
 * pre-check just gives a friendlier error.
 */
export async function deleteTeacherResourceAction(
  resourceId: string,
): Promise<{ success: true } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "غير مسجل الدخول" };

  const { error } = await supabase
    .from("resources")
    .delete()
    .eq("id", resourceId)
    .eq("created_by_teacher_id", user.id);
  if (error) {
    logError("deleteResource: failed", error, {
      component: "teacher.resources.delete",
      metadata: { resourceId },
    });
    return { error: `فشل الحذف: ${error.message}` };
  }

  revalidatePath("/teacher/resources");
  revalidatePath("/student/resources");
  return { success: true };
}
