"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import { register, type AuthResult } from "../actions";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

export function RegisterForm({ initialPlan }: { initialPlan?: string }) {
  const [showPassword, setShowPassword] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [state, formAction, pending] = useActionState<AuthResult, FormData>(
    register,
    {},
  );

  return (
    <>
      <h2 className="font-display mb-1 text-2xl font-bold leading-tight">إنشاء حساب</h2>
      <p className="mb-6 text-sm text-muted">انضم إلى أكاديمية فرقان</p>

      {state.error && (
        <div id="register-error" role="alert" className="mb-4 rounded-lg glass-danger p-3 text-sm text-error">
          {state.error}
        </div>
      )}

      {/* Terms/privacy clickwrap — gates BOTH signup paths (decision 43).
          Deliberately unchecked by default; the server action re-enforces it. */}
      <div className="mb-4">
        <label htmlFor="consent" className="flex items-start gap-2.5 text-sm">
          <input
            id="consent"
            name="consent"
            type="checkbox"
            value="yes"
            form="register-form"
            required
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            aria-describedby={state.error ? "register-error" : undefined}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-gold,#c8a24a)]"
          />
          <span>
            <span className="block">أوافق على الشروط والأحكام وسياسة الخصوصية</span>
            <span className="block text-[11px] text-muted-light">
              I agree to the Terms and Privacy Policy
            </span>
          </span>
        </label>
        {/* Policy links live OUTSIDE the label: a <label> must not wrap
            interactive content — clicking a nested link suppresses the
            checkbox toggle and muddles the control/label relationship for
            assistive tech. Kept as a separate, clearly-labelled line. */}
        <p className="mt-1.5 ps-6 text-[11px]">
          <Link href="/terms" className="text-gold hover:text-gold-hover underline focus-ring">الشروط والأحكام</Link>
          {" · "}
          <Link href="/privacy" className="text-gold hover:text-gold-hover underline focus-ring">سياسة الخصوصية</Link>
          {"  ·  "}
          <Link href="/terms" className="underline focus-ring">Terms</Link>
          {" · "}
          <Link href="/privacy" className="underline focus-ring">Privacy Policy</Link>
        </p>
        {!consentChecked && (
          <p className="mt-1.5 ps-6 text-[11px] text-muted">
            يرجى الموافقة أولاً لتفعيل التسجيل · Agree first to enable sign-up
          </p>
        )}
      </div>

      <GoogleSignInButton disabled={!consentChecked} consentMethod="checkbox" />

      <div className="my-4 flex items-center gap-3">
        <hr className="flex-1 border-t border-white/20" />
        <span className="text-xs text-muted">أو · or</span>
        <hr className="flex-1 border-t border-white/20" />
      </div>

      <form id="register-form" action={formAction} className="space-y-4">
        {/* Full Name */}
        <div>
          <label htmlFor="full_name" className="mb-1.5 block">
            <span className="block text-sm font-medium">الاسم الكامل</span>
            <span className="block text-[11px] uppercase tracking-wider text-muted-light">Full name</span>
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            autoComplete="name"
            className="w-full rounded-xl glass-input px-4 py-2.5 text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            placeholder="محمد أحمد"
          />
        </div>

        {/* Email */}
        <div>
          <label htmlFor="email" className="mb-1.5 block">
            <span className="block text-sm font-medium">البريد الإلكتروني</span>
            <span className="block text-[11px] uppercase tracking-wider text-muted-light">Email</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            dir="ltr"
            className="w-full rounded-xl glass-input px-4 py-2.5 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            placeholder="you@example.com"
          />
        </div>

        {/* Password */}
        <div>
          <label htmlFor="password" className="mb-1.5 block">
            <span className="block text-sm font-medium">كلمة المرور</span>
            <span className="block text-[11px] uppercase tracking-wider text-muted-light">
              Password (min 8 characters)
            </span>
          </label>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              dir="ltr"
              className="w-full rounded-xl glass-input px-4 py-2.5 ps-10 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-foreground focus-ring"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="confirm_password" className="mb-1.5 block">
            <span className="block text-sm font-medium">تأكيد كلمة المرور</span>
            <span className="block text-[11px] uppercase tracking-wider text-muted-light">Confirm password</span>
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            dir="ltr"
            className="w-full rounded-xl glass-input px-4 py-2.5 text-left text-foreground placeholder:text-muted/50 focus:border-input-focus focus:outline-none focus:ring-1 focus:ring-input-focus"
            placeholder="••••••••"
          />
        </div>

        {initialPlan && <input type="hidden" name="plan" value={initialPlan} />}

        {/* Submit */}
        <button
          type="submit"
          disabled={pending || !consentChecked}
          className="flex w-full items-center justify-center gap-2 rounded-full glass-gold glass-pill py-2.5 font-semibold text-background transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-background/30 border-t-background" />
          ) : (
            <>
              <UserPlus size={18} aria-hidden="true" />
              إنشاء حساب
            </>
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        لديك حساب بالفعل؟{" "}
        <Link href="/login" className="text-gold hover:text-gold-hover">
          تسجيل الدخول
        </Link>
      </p>
    </>
  );
}
