import type { Metadata } from "next";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "استعادة كلمة المرور | فرقان" };

/**
 * Render the forgot password page with the password recovery form.
 *
 * @returns The React element for the forgot password page. 
 */
export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
