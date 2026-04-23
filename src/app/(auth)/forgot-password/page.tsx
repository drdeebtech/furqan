import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = {
  title: "استعادة كلمة المرور",
  description:
    "استعد كلمة مرور حسابك في أكاديمية فرقان عبر البريد الإلكتروني. Recover your FURQAN Quran Academy password via email.",
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
