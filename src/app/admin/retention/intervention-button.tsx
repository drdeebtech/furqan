"use client";

import { useActionState } from "react";
import { logIntervention, type InterventionType } from "./actions";

interface Props {
  studentId: string;
  interventionType: InterventionType;
  label: string;
  lastInterventionAt: string | null;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export function InterventionButton({ studentId, interventionType, label, lastInterventionAt }: Props) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { ok: boolean; error?: string } | null, formData: FormData) => {
      return await logIntervention(formData);
    },
    null,
  );

  const days = daysSince(lastInterventionAt);
  const recent = days !== null && days < 7;

  return (
    <form action={formAction}>
      <input type="hidden" name="student_id" value={studentId} />
      <input type="hidden" name="intervention_type" value={interventionType} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          state?.ok
            ? "bg-success/10 text-success"
            : recent
              ? "bg-warning/10 text-warning hover:bg-warning/20"
              : "glass-gold hover:bg-gold/20"
        }`}
        title={recent ? `آخر تدخل قبل ${days} يوم` : state?.error ?? label}
      >
        {pending ? "..." : state?.ok ? "✓ تم" : label}
      </button>
    </form>
  );
}
