import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "تسجيل الدخول",
  description:
    "ادخل إلى حسابك في أكاديمية فرقان للقرآن الكريم للوصول إلى جلساتك ومعلمك. Sign in to your FURQAN Quran Academy account to access your sessions and teacher.",
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
