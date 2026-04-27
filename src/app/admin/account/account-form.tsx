"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { updatePersonalInfo } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { LoudResult } from "@/lib/actions/loud";

const input =
  "w-full rounded-xl glass-input px-4 py-2.5 text-sm text-foreground focus:border-gold focus:outline-none";

interface Props {
  profile: {
    full_name: string | null;
    full_name_ar: string | null;
    phone: string | null;
    country: string | null;
    timezone: string | null;
    lang: string | null;
    date_of_birth: string | null;
  };
}

export function AccountForm({ profile }: Props) {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(
    updatePersonalInfo,
    null,
  );

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      <ActionFeedback state={state} />

      <Field label="الاسم الكامل" hint="Full name (English)" name="full_name" defaultValue={profile.full_name ?? ""} />
      <Field label="الاسم بالعربية" hint="Arabic name" name="full_name_ar" defaultValue={profile.full_name_ar ?? ""} />
      <Field label="رقم الجوال" hint="Phone" name="phone" defaultValue={profile.phone ?? ""} ltr />
      <Field label="الدولة" hint="Country" name="country" defaultValue={profile.country ?? ""} />
      <Field label="المنطقة الزمنية" hint="Timezone" name="timezone" defaultValue={profile.timezone ?? ""} ltr placeholder="Africa/Cairo" />
      <Field label="اللغة" hint="ar / en" name="lang" defaultValue={profile.lang ?? ""} ltr placeholder="ar" />
      <Field label="تاريخ الميلاد" hint="Date of birth" name="date_of_birth" defaultValue={profile.date_of_birth ?? ""} ltr type="date" />

      <div className="md:col-span-2 flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="glass-gold glass-pill flex min-h-[44px] items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-gold-hover disabled:opacity-50"
        >
          {pending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Save size={14} aria-hidden="true" />
          )}
          حفظ البيانات
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  name,
  defaultValue,
  ltr,
  type = "text",
  placeholder,
}: {
  label: string;
  hint: string;
  name: string;
  defaultValue: string;
  ltr?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
        <span className="me-2 text-xs text-muted">{hint}</span>
      </label>
      <input
        id={name}
        name={name}
        type={type}
        dir={ltr ? "ltr" : undefined}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`${input} ${ltr ? "text-left" : ""}`}
      />
    </div>
  );
}
