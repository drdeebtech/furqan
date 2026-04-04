import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول | فرقان" };

/**
 * Renders the login page containing the authentication form wrapped in a Suspense boundary.
 *
 * @returns The page's JSX element that renders the `LoginForm` inside a React `Suspense` boundary.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
