"use server";

import { checkBotId } from "botid/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendContactNotification } from "@/lib/email";
import { notifyNewContact } from "@/lib/whatsapp";
import { logError } from "@/lib/logger";

export async function submitContactForm(
  _prev: { success?: boolean; error?: string },
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  // Vercel BotID gate — invisible CAPTCHA on the public contact form to
  // stop spam submissions before they hit the DB / email pipeline.
  const verification = await checkBotId();
  if (!verification.isHuman) {
    return { error: "تعذر التحقق من الطلب — حاول مرة أخرى" };
  }

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

  try {
    const supabase = createAdminClient();

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
      logError("Contact form DB error", dbError, { tag: "contact-form" });
      return { error: "حدث خطأ — حاول مرة أخرى" };
    }
  } catch (e) {
    logError("Contact form error", e, { tag: "contact-form" });
    return { error: "حدث خطأ — حاول مرة أخرى" };
  }

  // Send WhatsApp notification (non-blocking)
  try {
    await notifyNewContact(fullName, email, packageInterest ?? undefined);
  } catch (err) {
    logError("WhatsApp notify failed in submitContactForm", err, {
      component: "public.contact.submitContactForm",
      metadata: { email },
    });
  }

  // Send email notification (non-blocking, don't fail form)
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
  } catch (err) {
    // Email failure doesn't block — submission is saved in DB
    logError("Email notify failed in submitContactForm", err, {
      component: "public.contact.submitContactForm",
      metadata: { email },
    });
  }

  return { success: true };
}
