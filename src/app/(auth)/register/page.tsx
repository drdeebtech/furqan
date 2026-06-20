import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "إنشاء حساب",
  description:
    "سجّل مجاناً في أكاديمية فرقان وابدأ تعلّم القرآن الكريم مع معلمين حاصلين على الإجازة. Create a free account at FURQAN Quran Academy and start learning with Ijazah-certified teachers.",
  alternates: { canonical: "https://www.furqan.today/register" },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  return <RegisterForm initialPlan={plan} />;
}
