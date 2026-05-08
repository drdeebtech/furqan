"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, ForbiddenError } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import { loudAction } from "@/lib/actions/loud";

export interface GrantResult {
  success?: string;
  error?: string;
}

interface StudentLookup {
  id: string;
  full_name: string;
}

interface ActivePackage {
  id: string;
  sessions_total: number;
  sessions_used: number;
  expires_at: string | null;
}

class UserError extends Error {
  readonly userError = true;
  constructor(msg: string) { super(msg); this.name = "UserError"; }
}

async function adminPreflight(): Promise<{ actorId: string }> {
  try {
    const { id } = await requireAdmin();
    return { actorId: id };
  } catch (e) {
    if (e instanceof ForbiddenError) {
      throw new UserError(e.message === "not authenticated" ? "غير مصرح" : "هذا الإجراء للمشرفين فقط");
    }
    throw e;
  }
}

const grantCreditSchema = z.object({
  email: z.string().min(1, "البريد الإلكتروني مطلوب").transform((s) => s.trim().toLowerCase()),
  sessions: z.number().int().min(1, "عدد الجلسات يجب أن يكون بين 1 و 50").max(50, "عدد الجلسات يجب أن يكون بين 1 و 50"),
  reason: z.string().min(3, "يرجى إدخال سبب واضح للمنح").transform((s) => s.trim()),
});

const grantCreditBase = loudAction<z.infer<typeof grantCreditSchema>, { message: string }>({
  name: "admin.credits.grant",
  // Manual money grant — irreversible once the student spends sessions.
  // Critical so a silent failure pages Telegram, not just Sentry.
  severity: "critical",
  schema: grantCreditSchema,
  audit: {
    table: "student_packages",
    // recordId resolves at envelope-write time; we don't know the package
    // id yet, so use the email as a stable identifier. The diff audit row
    // inside the handler carries the real package id with old/new totals.
    recordId: (i) => `email:${i.email}`,
    action: "UPDATE",
    reasonPrefix: "admin manual credit grant",
  },
  preflight: adminPreflight,
  handler: async ({ email, sessions, reason }, { actorId }) => {
    const admin = createAdminClient();

    const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const authUser = authList?.users.find((u) => u.email?.toLowerCase() === email);
    if (!authUser) throw new UserError("لم يتم العثور على الطالب بهذا البريد");

    const { data: student } = await admin
      .from("profiles")
      .select("id, full_name")
      .eq("id", authUser.id)
      .eq("role", "student")
      .single<StudentLookup>();
    if (!student) throw new UserError("لم يتم العثور على الطالب بهذا البريد");

    const { data: packages } = await admin
      .from("student_packages")
      .select("id, sessions_total, sessions_used, expires_at")
      .eq("student_id", student.id)
      .eq("status", "active")
      .order("expires_at", { ascending: true, nullsFirst: false })
      .returns<ActivePackage[]>();

    const activePkg = packages?.[0];
    if (!activePkg) {
      throw new UserError("لا توجد باقة نشطة لهذا الطالب — أنشئ باقة أولاً من صفحة الباقات");
    }

    const newTotal = activePkg.sessions_total + sessions;
    const { error: updateErr } = await admin
      .from("student_packages")
      .update({ sessions_total: newTotal } as never)
      .eq("id", activePkg.id);
    if (updateErr) throw updateErr;

    await admin.from("audit_log").insert({
      changed_by: actorId,
      table_name: "student_packages",
      record_id: activePkg.id,
      action: "UPDATE",
      old_data: { sessions_total: activePkg.sessions_total },
      new_data: { sessions_total: newTotal, granted: sessions },
      reason: `Manual credit grant (${sessions} sessions): ${reason}`,
    }).then((r) => {
      if (r.error) logError("grantCreditAction: diff audit row failed", r.error, { tag: "admin-credits" });
    });

    try {
      await notify({
        userId: student.id,
        type: "system",
        title: "تمت إضافة جلسات إلى باقتك",
        body: `أضاف المشرف ${sessions} جلسة إلى باقتك. السبب: ${reason}`,
        entityType: "student_package",
        entityId: activePkg.id,
      });
    } catch (err) {
      logError("grantCreditAction: notify failed", err, { tag: "admin-credits" });
    }

    revalidatePath("/admin/credits");
    revalidatePath("/student/packages");

    const newRemaining = newTotal - activePkg.sessions_used;
    return {
      message: `تم منح ${sessions} جلسة للطالب ${student.full_name}. رصيده الجديد: ${newRemaining}`,
    };
  },
});

export async function grantCreditAction(
  _prev: GrantResult,
  formData: FormData,
): Promise<GrantResult> {
  const parsed = grantCreditSchema.safeParse({
    email: String(formData.get("student_email") ?? ""),
    sessions: Number(formData.get("sessions") ?? 0),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" };
  }
  const result = await grantCreditBase(parsed.data);
  if (!result.ok) return { error: result.error };
  return { success: result.message };
}
