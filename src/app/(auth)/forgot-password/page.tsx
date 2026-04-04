import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "استعادة كلمة المرور" };

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
