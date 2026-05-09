"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { invalidateByTag } from "@vercel/functions";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { invalidateRoleCache } from "@/lib/auth/role-cache";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";
import type { TableInsert, TableUpdate } from "@/lib/supabase/typed-helpers";

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string, options?: { cause?: unknown }) { super(msg, options); this.name = "UserError"; }
}

async function adminPreflight(): Promise<{ actorId: string }> {
  try {
    const { id } = await requireAdmin();
    return { actorId: id };
  } catch (e) {
    if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
    throw e;
  }
}

type CreateTeacherInput = {
  teacherId: string;
  bio: string | null;
  bio_en: string | null;
  specialties: string[];
  recitation_standards: string[];
  hourly_rate: number;
  gender: "male" | "female" | null;
  languages: string[];
};

const createTeacherBase = loudAction<CreateTeacherInput, { message: string }>({
  name: "admin.teachers.create",
  // P0 in audit (role mutation). `warning` matches the established
  // setUserRoles severity — destructive enough for Sentry capture, not
  // critical enough to page Telegram on every routine teacher promotion.
  severity: "warning",
  // FormData decode happens in the public wrapper; the schema here just
  // documents the typed-input contract for any non-form caller.
  schema: z.object({
    teacherId: z.string().uuid(),
    bio: z.string().nullable(),
    bio_en: z.string().nullable(),
    specialties: z.array(z.string()),
    recitation_standards: z.array(z.string()),
    hourly_rate: z.number(),
    gender: z.enum(["male", "female"]).nullable(),
    languages: z.array(z.string()),
  }) as unknown as z.ZodType<CreateTeacherInput>,
  audit: {
    table: "teacher_profiles",
    recordId: (i) => i.teacherId,
    action: "UPDATE",
    reasonPrefix: "admin promote / upsert teacher profile",
  },
  preflight: adminPreflight,
  handler: async (input) => {
    const supabase = await createClient();

    const { data: existing } = await supabase
      .from("teacher_profiles")
      .select("teacher_id")
      .eq("teacher_id", input.teacherId)
      .single();

    const row: TableInsert<"teacher_profiles"> = {
      teacher_id: input.teacherId,
      bio: input.bio,
      bio_en: input.bio_en,
      specialties: input.specialties,
      hourly_rate: input.hourly_rate,
      gender: input.gender,
      languages: input.languages,
      recitation_standards: input.recitation_standards,
    };

    if (existing) {
      const { error } = await supabase.from("teacher_profiles").update(row).eq("teacher_id", input.teacherId);
      if (error) throw new UserError("فشل تحديث الملف: " + error.message, { cause: error });
    } else {
      const { error } = await supabase.from("teacher_profiles").insert(row);
      if (error) throw new UserError("فشل إنشاء الملف: " + error.message, { cause: error });
    }

    const { error: roleError } = await supabase
      .from("profiles")
      .update({ role: "teacher" } satisfies TableUpdate<"profiles">)
      .eq("id", input.teacherId);
    if (roleError) throw new UserError("تم إنشاء الملف لكن فشل تحديث الدور: " + roleError.message, { cause: roleError });

    // Promoted to teacher — flush per-user role cache so middleware
    // doesn't keep them as "student" for up to the 10s TTL fallback.
    invalidateRoleCache(input.teacherId);

    revalidatePath("/admin/teachers");
    revalidatePath("/admin/users");
    revalidatePath("/teachers");
    revalidateTag("teachers-public", "max");
    // CDN edge cache invalidation — best-effort. A failure here just means
    // the public list takes up to 5min (ISR window) to reflect the new
    // teacher; not worth failing the whole action over.
    await invalidateByTag("teachers-public").catch((err) =>
      logError("createTeacher: invalidateByTag failed", err, { tag: "admin-teachers" })
    );

    return { message: "created" };
  },
});

export async function createTeacher(formData: FormData): Promise<void> {
  const teacherId = formData.get("teacher_id") as string;
  if (!teacherId) redirect("/admin/teachers?error=missing_teacher_id");

  const specialties = formData.getAll("specialties") as string[];
  const recitationStandards = formData.getAll("recitation_standards") as string[];
  const pickedLangs = (formData.getAll("languages") as string[]).filter(Boolean);

  const input: CreateTeacherInput = {
    teacherId,
    bio: (formData.get("bio") as string) || null,
    bio_en: (formData.get("bio_en") as string) || null,
    specialties: specialties.filter(Boolean),
    recitation_standards: recitationStandards.length > 0 ? recitationStandards.filter(Boolean) : ["hafs"],
    hourly_rate: Number(formData.get("hourly_rate")) || 20,
    // FormData arrives untyped; the column is the gender_type enum
    // ('male' | 'female'). Narrowing cast documents the expected type.
    gender: ((formData.get("gender") as string) || null) as "male" | "female" | null,
    languages: pickedLangs.length > 0 ? pickedLangs : ["ar"],
  };

  const result = await createTeacherBase(input);
  if (!result.ok) {
    redirect(`/admin/teachers?error=${encodeURIComponent(result.error)}`);
  }
  redirect("/admin/teachers?success=created");
}
