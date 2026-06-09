"use server";

import { z } from "zod";
import { checkBotId } from "botid/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendContactNotification } from "@/lib/email";
import { notifyNewContact } from "@/lib/whatsapp";
import { logError } from "@/lib/logger";

// Boundary schema for the public, unauthenticated contact form. Length caps
// prevent multi-MB `message` blobs being stored at scale (write-amplification
// / storage DoS), and the email check keeps malformed addresses out of the
// reply pipeline. Optional fields accept "" so empty inputs normalize to null.
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

const contactSchema = z.object({
  full_name: z.string().trim().min(2, "الاسم مطلوب").max(120),
  email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صالح").max(254),
  whatsapp: optionalText(40),
  country: optionalText(80),
  student_age: optionalText(20),
  package: optionalText(80),
  message: optionalText(4000),
});

const nullify = (v: string | undefined): string | null =>
  v && v.length > 0 ? v : null;

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

  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "البيانات المُدخلة غير صالحة — تحقق من الاسم والبريد" };
  }

  const fullName = parsed.data.full_name;
  const email = parsed.data.email;
  const whatsapp = nullify(parsed.data.whatsapp);
  const country = nullify(parsed.data.country);
  const studentAge = nullify(parsed.data.student_age);
  const packageInterest = nullify(parsed.data.package);
  const message = nullify(parsed.data.message);

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
