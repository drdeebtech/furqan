import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "إنشاء حساب | فرقان" };

/**
 * Renders the registration page content.
 *
 * @returns The page's JSX element containing the RegisterForm component.
 */
export default function RegisterPage() {
  return <RegisterForm />;
}
