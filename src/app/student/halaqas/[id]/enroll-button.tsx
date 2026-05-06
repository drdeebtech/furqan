"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import {
  enrollInHalaqa,
  cancelHalaqaEnrollment,
  joinHalaqaWaitingList,
  leaveHalaqaWaitingList,
  type EnrollState,
  type WaitlistState,
} from "../actions";

type Mode = "enroll" | "cancel" | "join-waitlist" | "leave-waitlist";

interface Props {
  sessionId: string;
  mode: Mode;
}

const initialEnrollState: EnrollState = {};
const initialWaitlistState: WaitlistState = {};

export function EnrollButton({ sessionId, mode }: Props) {
  const { t } = useLang();
  const router = useRouter();
  const toast = useToast();

  // Each branch picks the right action + initial state shape.
  if (mode === "enroll" || mode === "cancel") {
    return (
      <EnrollFlavorButton
        sessionId={sessionId}
        mode={mode}
        action={mode === "enroll" ? enrollInHalaqa : cancelHalaqaEnrollment}
        successMsg={
          mode === "enroll"
            ? t("تم تسجيلك في الحلقة", "You're enrolled")
            : t("تم إلغاء التسجيل", "Enrollment cancelled")
        }
        label={
          mode === "enroll"
            ? t("سجّل في الحلقة", "Enroll in this halaqa")
            : t("إلغاء التسجيل", "Cancel enrollment")
        }
        flavor={mode === "enroll" ? "primary" : "danger"}
        router={router}
        toast={toast}
      />
    );
  }

  return (
    <WaitlistFlavorButton
      sessionId={sessionId}
      mode={mode}
      action={mode === "join-waitlist" ? joinHalaqaWaitingList : leaveHalaqaWaitingList}
      successMsg={
        mode === "join-waitlist"
          ? t("تمت إضافتك إلى قائمة الانتظار", "Added to waiting list")
          : t("تمت مغادرة قائمة الانتظار", "Left the waiting list")
      }
      label={
        mode === "join-waitlist"
          ? t("انضم إلى قائمة الانتظار", "Join the waiting list")
          : t("غادر قائمة الانتظار", "Leave the waiting list")
      }
      flavor={mode === "join-waitlist" ? "secondary" : "muted"}
      router={router}
      toast={toast}
    />
  );
}

function EnrollFlavorButton({
  sessionId,
  action,
  successMsg,
  label,
  flavor,
  router,
  toast,
}: {
  sessionId: string;
  mode: Mode;
  action: (prev: EnrollState, formData: FormData) => Promise<EnrollState>;
  successMsg: string;
  label: string;
  flavor: "primary" | "danger";
  router: ReturnType<typeof useRouter>;
  toast: ReturnType<typeof useToast>;
}) {
  const [state, formAction, pending] = useActionState(action, initialEnrollState);

  useEffect(() => {
    if (state.ok) {
      toast.success(successMsg);
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="session_id" value={sessionId} />
      <button type="submit" disabled={pending} className={buttonClass(flavor, pending)}>
        {pending ? "…" : label}
      </button>
    </form>
  );
}

function WaitlistFlavorButton({
  sessionId,
  action,
  successMsg,
  label,
  flavor,
  router,
  toast,
}: {
  sessionId: string;
  mode: Mode;
  action: (prev: WaitlistState, formData: FormData) => Promise<WaitlistState>;
  successMsg: string;
  label: string;
  flavor: "secondary" | "muted";
  router: ReturnType<typeof useRouter>;
  toast: ReturnType<typeof useToast>;
}) {
  const [state, formAction, pending] = useActionState(action, initialWaitlistState);

  useEffect(() => {
    if (state.ok) {
      toast.success(
        state.position
          ? `${successMsg} — ${state.position}`
          : successMsg,
      );
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="session_id" value={sessionId} />
      <button type="submit" disabled={pending} className={buttonClass(flavor, pending)}>
        {pending ? "…" : label}
      </button>
    </form>
  );
}

function buttonClass(flavor: "primary" | "danger" | "secondary" | "muted", pending: boolean): string {
  const base =
    "glass-pill w-full px-6 py-3 text-base font-semibold transition-colors disabled:opacity-50";
  switch (flavor) {
    case "primary":
      return `${base} glass-gold`;
    case "danger":
      return `${base} border border-error/30 bg-error/10 text-error hover:bg-error/20`;
    case "secondary":
      return `${base} border border-info/30 bg-info/10 text-info hover:bg-info/20`;
    case "muted":
      return `${base} border border-card-border bg-surface/40 text-muted hover:bg-surface/60`;
  }
  return pending ? base : base;
}
