"use server";

import { createClient } from "@/lib/supabase/server";
import { sendContactNotification } from "@/lib/email";

export async function submitContactForm(
  _prev: { success?: boolean; error?: string },
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const fullName = formData.get("full_name") as string;
  const email = formData.get("email") as string;
  const whatsapp = formData.get("whatsapp") as string || null;
  const country = formData.get("country") as string || null;
  const studentAge = formData.get("student_age") as string || null;
  const packageInterest = formData.get("package") as string || null;
  const message = formData.get("message") as string || null;

  if (!fullName || !email) {
    return { error: "الاسم والبريد الإلكتروني مطلوبان" };
  }

  const supabase = await createClient();

  // Save to database
  const { error: dbError } = await supabase.from("contact_submissions").insert({
    full_name: fullName,
    email,
    whatsapp,
    country,
    student_age: studentAge,
    package_interest: packageInterest,
    message,
  } as never);

  if (dbError) {
    return { error: "حدث خطأ — حاول مرة أخرى" };
  }

  // Send email notification (non-blocking)
  try {
    await sendContactNotification({
      fullName,
      email,
      whatsapp: whatsapp ?? undefined,
      country: country ?? undefined,
      studentAge: studentAge ?? undefined,
      packageInterest: packageInterest ?? undefined,
      message: message ?? undefined,
    });
  } catch {
    // Email failure doesn't block — submission is saved in DB
  }

  return { success: true };
}
