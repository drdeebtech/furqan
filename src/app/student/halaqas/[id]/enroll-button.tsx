"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { enrollInHalaqa, cancelHalaqaEnrollment, type EnrollState } from "../actions";

interface Props {
  sessionId: string;
  mode: "enroll" | "cancel";
}

const initialState: EnrollState = {};

export function EnrollButton({ sessionId, mode }: Props) {
  const { t } = useLang();
  const router = useRouter();
  const toast = useToast();
  const action = mode === "enroll" ? enrollInHalaqa : cancelHalaqaEnrollment;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.ok) {
      toast.success(
        mode === "enroll"
          ? t("تم تسجيلك في الحلقة", "You're enrolled")
          : t("تم إلغاء التسجيل", "Enrollment cancelled"),
      );
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const enrollClass =
    "glass-gold glass-pill w-full px-6 py-3 text-base font-semibold transition-colors disabled:opacity-50";
  const cancelClass =
    "glass-pill w-full border border-error/30 bg-error/10 px-6 py-3 text-base font-semibold text-error transition-colors hover:bg-error/20 disabled:opacity-50";

  return (
    <form action={formAction}>
      <input type="hidden" name="session_id" value={sessionId} />
      <button
        type="submit"
        disabled={pending}
        className={mode === "enroll" ? enrollClass : cancelClass}
      >
        {pending
          ? t("جاري المعالجة...", "Processing…")
          : mode === "enroll"
            ? t("سجّل في الحلقة", "Enroll in this halaqa")
            : t("إلغاء التسجيل", "Cancel enrollment")}
      </button>
    </form>
  );
}
