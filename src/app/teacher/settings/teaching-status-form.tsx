"use client";

import { useActionState } from "react";
import { useRef } from "react";
import { updateTeachingStatus } from "./actions";
import { ActionFeedback } from "@/components/shared/action-feedback";
import type { LoudResult } from "@/lib/actions/loud";

export function TeachingStatusForm({ initialIsAccepting }: { initialIsAccepting: boolean }) {
  const [state, formAction, pending] = useActionState<LoudResult | null, FormData>(
    updateTeachingStatus,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <ActionFeedback state={state} />

      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--surface-border)] p-4 transition-colors hover:border-gold/30">
        <input
          type="checkbox"
          name="is_accepting"
          defaultChecked={initialIsAccepting}
          disabled={pending}
          onChange={() => formRef.current?.requestSubmit()}
          className="h-5 w-5 accent-gold"
        />
        <div className="flex-1">
          <p className="text-sm font-medium">
            أنا أقبل طلابًا جددًا حاليًا
            <span className="me-2 text-xs font-normal text-muted">
              I&apos;m currently accepting new students
            </span>
          </p>
          <p className="mt-1 text-xs text-muted">
            عند إيقاف هذا الخيار، لن يظهر اسمك في صفحة المعلمين العامة ولن يستطيع الطلاب الجدد حجز جلسات معك.
          </p>
        </div>
      </label>
    </form>
  );
}
