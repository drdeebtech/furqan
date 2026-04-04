import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "إنشاء حساب | فرقان" };

export default function RegisterPage() {
  return <RegisterForm />;
}
