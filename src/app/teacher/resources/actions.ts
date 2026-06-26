"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import type { TableInsert } from "@/lib/supabase/typed-helpers";

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

  // Defense-in-depth role gate — server actions are reachable without the
  // edge middleware. Verify the caller holds the teacher/admin role here too.
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!callerProfile || !["teacher", "admin"].includes(callerProfile.role)) {
    return { error: "ليس لديك صلاحية" };
  }

  const title_ar = String(formData.get("title_ar") ?? "").trim();
  const description_ar =
    String(formData.get("description_ar") ?? "").trim() || null;
  const resource_type = String(formData.get("resource_type") ?? "");
  const category =
    String(formData.get("category") ?? "general").trim() || "general";
  const external_url_input =
    String(formData.get("external_url") ?? "").trim() || null;
  const fileEntry = formData.get("file");

  if (!title_ar) return { error: "العنوان مطلوب" };
  if (!(VALID_TYPES as readonly string[]).includes(resource_type)) {
    return { error: "نوع غير صالح" };
  }

  // Validate the external URL scheme at the write boundary. `external_url` is
  // later rendered into an anchor `href` shown to every student, so a
  // `javascript:`/`data:` URI stored here would be stored XSS. Allow http(s)
  // only.
  let external_url_raw: string | null = null;
  if (external_url_input) {
    const parsed = z.string().url().safeParse(external_url_input);
    if (!parsed.success || !/^https?:\/\//i.test(parsed.data)) {
      return { error: "رابط خارجي غير صالح — يجب أن يبدأ بـ http(s)://" };
    }
    external_url_raw = parsed.data;
  }

  let file_url: string | null = null;
  if (fileEntry instanceof File && fileEntry.size > 0) {
    if (fileEntry.size > MAX_UPLOAD_BYTES) {
      return { error: "الملف كبير جدًا — الحد الأقصى 50 ميغابايت" };
    }
    // admin: upload to 'resources' storage bucket (INSERT policy is admin-only) (issue #523)
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
    } satisfies TableInsert<"resources">)
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

  // Tenant check (audit H3): studentId is caller-controlled. Owning the
  // resource does not grant the right to assign it to an ARBITRARY user and
  // fire a notification at them. Require a prior teacher↔student booking — the
  // same relationship gate requestFreshRecitation uses.
  const relRes = await supabase
    .from("bookings")
    .select("id")
    .eq("teacher_id", user.id)
    .eq("student_id", studentId)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (relRes.error) {
    logError("assignResource: relationship lookup failed", relRes.error, {
      component: "teacher.resources.assign",
      metadata: { resourceId, studentId },
    });
    return { error: "فشل التحقق من العلاقة بالطالب" };
  }
  if (!relRes.data) {
    return { error: "لا يوجد حجز سابق مع هذا الطالب" };
  }

  // resource_assignments is now in the generated types (merged via
  // migration 20260506134112) — the runtime client cast is no longer needed.
  const insertRes = await supabase
    .from("resource_assignments")
    .insert({
      resource_id: resourceId,
      student_id: studentId,
      halaqa_id: null,
      assigned_by: user.id,
    } satisfies TableInsert<"resource_assignments">);
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
    await notify({
      userId: studentId,
      type: "system",
      title: "مصدر جديد",
      body: `شارك معك معلمك مصدراً جديداً — ${ownerRes.data.title_ar}.`,
      entityType: "system",
      entityId: resourceId,
    });
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

  // created_by_teacher_id is now in the generated types (migration
  // 20260506134112 merged) — the runtime cast is no longer needed.
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
