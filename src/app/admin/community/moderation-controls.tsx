"use client";

import { useTransition } from "react";
import { Pin, Lock, EyeOff, Eye, Check, X } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import {
  moderateThread,
  moderateReply,
  resolveReport,
} from "@/lib/actions/community";

type Kind = "thread" | "report";

interface Props {
  kind: Kind;
  targetId: string;
  initial?: { is_pinned: boolean; is_locked: boolean; is_hidden: boolean };
  extraTargetType?: "thread" | "reply"; // for report-kind
  extraTargetId?: string;                // for report-kind
}

export function ModerationControls({ kind, targetId, initial, extraTargetType, extraTargetId }: Props) {
  const { t } = useLang();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const handle = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(t("تم", "Done"));
      else toast.error(res.error ?? t("فشل", "Failed"));
    });
  };

  if (kind === "thread" && initial) {
    return (
      <div className="flex items-center gap-1">
        <IconButton
          aria-label={initial.is_pinned ? t("إلغاء التثبيت", "Unpin") : t("تثبيت", "Pin")}
          active={initial.is_pinned}
          icon={<Pin size={13} />}
          onClick={() => handle(() => moderateThread(targetId, { is_pinned: !initial.is_pinned }))}
          pending={pending}
          color="gold"
        />
        <IconButton
          aria-label={initial.is_locked ? t("فتح", "Unlock") : t("قفل", "Lock")}
          active={initial.is_locked}
          icon={<Lock size={13} />}
          onClick={() => handle(() => moderateThread(targetId, { is_locked: !initial.is_locked }))}
          pending={pending}
          color="muted"
        />
        <IconButton
          aria-label={initial.is_hidden ? t("إظهار", "Show") : t("إخفاء", "Hide")}
          active={initial.is_hidden}
          icon={initial.is_hidden ? <Eye size={13} /> : <EyeOff size={13} />}
          onClick={() => handle(() => moderateThread(targetId, { is_hidden: !initial.is_hidden }))}
          pending={pending}
          color="error"
        />
      </div>
    );
  }

  if (kind === "report") {
    return (
      <div className="flex items-center gap-1">
        {extraTargetType === "thread" && extraTargetId && (
          <button
            type="button"
            onClick={() => handle(async () => {
              await moderateThread(extraTargetId, { is_hidden: true });
              return resolveReport(targetId, "resolved");
            })}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg border border-error/30 bg-error/10 px-2 py-1 text-xs text-error hover:bg-error/20 disabled:opacity-50"
          >
            <EyeOff size={12} aria-hidden="true" /> {t("إخفاء + حل", "Hide & Resolve")}
          </button>
        )}
        {extraTargetType === "reply" && extraTargetId && (
          <button
            type="button"
            onClick={() => handle(async () => {
              await moderateReply(extraTargetId, true);
              return resolveReport(targetId, "resolved");
            })}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-lg border border-error/30 bg-error/10 px-2 py-1 text-xs text-error hover:bg-error/20 disabled:opacity-50"
          >
            <EyeOff size={12} aria-hidden="true" /> {t("إخفاء الرد + حل", "Hide & Resolve")}
          </button>
        )}
        <button
          type="button"
          onClick={() => handle(() => resolveReport(targetId, "dismissed"))}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg border border-[var(--surface-border)] px-2 py-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
        >
          <X size={12} aria-hidden="true" /> {t("رفض", "Dismiss")}
        </button>
        <button
          type="button"
          onClick={() => handle(() => resolveReport(targetId, "resolved"))}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-lg border border-success/30 bg-success/10 px-2 py-1 text-xs text-success hover:bg-success/20 disabled:opacity-50"
        >
          <Check size={12} aria-hidden="true" /> {t("حل", "Resolve")}
        </button>
      </div>
    );
  }

  return null;
}

function IconButton({
  active, icon, onClick, pending, color, ...rest
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  pending: boolean;
  color: "gold" | "muted" | "error";
} & React.HTMLAttributes<HTMLButtonElement>) {
  const cls = active
    ? color === "gold"   ? "text-gold"
    : color === "error"  ? "text-error"
    :                      "text-foreground"
    : "text-muted-light hover:text-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`rounded p-1.5 transition-colors disabled:opacity-50 ${cls}`}
      {...rest}
    >
      {icon}
    </button>
  );
}
