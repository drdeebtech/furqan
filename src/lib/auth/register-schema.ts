import { z } from "zod";

/**
 * Validation for the /register server action (repo rule: zod at every action
 * boundary). Kept as a pure module so it unit-tests without mocking
 * next/headers, BotID, or Supabase.
 *
 * `consent` must be the literal "yes" — an absent field (hostile client that
 * strips the checkbox) and any other value both fail. The checkbox is the
 * UI layer; THIS is the enforcement layer.
 */
export const registerSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  email: z.email().trim().max(320),
  password: z.string().min(8).max(200),
  confirm_password: z.string().min(1),
  consent: z.literal("yes"),
  plan: z.string().max(100).nullish(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/** Arabic-first field errors matching the existing auth error style. */
export function registerErrorMessage(error: z.ZodError): string {
  const fields = new Set(error.issues.map((i) => String(i.path[0] ?? "")));
  if (fields.has("consent")) {
    return "يجب الموافقة على الشروط وسياسة الخصوصية للمتابعة";
  }
  if (fields.has("email")) {
    return "البريد الإلكتروني غير صالح";
  }
  if (fields.has("password") || fields.has("confirm_password")) {
    return "كلمة المرور ضعيفة — استخدم 8+ أحرف بخلطة من الحروف والأرقام";
  }
  return "جميع الحقول مطلوبة";
}
