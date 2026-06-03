"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { MoreVertical, Play, CheckCircle2, EyeOff } from "lucide-react";
import { useLang } from "@/lib/i18n/context";
import { useToast } from "@/components/shared/toast";
import { markLessonComplete, setLessonHidden } from "@/lib/actions/course-playback";

interface LessonRowActionsProps {
  lessonId: string;
  href: string;
}

export function LessonRowActions({ lessonId, href }: LessonRowActionsProps) {
  const { t } = useLang();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const onComplete = () => {
    startTransition(async () => {
      const res = await markLessonComplete(lessonId);
      if (res.ok) {
        toast.success(t("تم الإكمال", "Marked complete"));
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  const onHide = () => {
    startTransition(async () => {
      const res = await setLessonHidden({ lessonId, hidden: true });
      if (res.ok) {
        toast.success(t("تم الإخفاء من القائمة", "Hidden from list"));
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="flex items-center gap-1">
      <Link
        href={href}
        aria-label={t("متابعة", "Resume")}
        className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted-light,#9CA3AF)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <Play size={14} aria-hidden="true" />
      </Link>
      <div ref={ref} className="relative">
        <button
          type="button"
          aria-label={t("إجراءات", "Row actions")}
          aria-expanded={open}
          aria-haspopup="menu"
          disabled={pending}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted-light,#9CA3AF)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-40"
        >
          <MoreVertical size={14} aria-hidden="true" />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute end-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-lg"
          >
            <Link
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/5"
            >
              <Play size={13} aria-hidden="true" /> {t("متابعة", "Resume")}
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={onComplete}
              disabled={pending}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-foreground/5 disabled:opacity-50"
            >
              <CheckCircle2 size={13} aria-hidden="true" /> {t("تم الإكمال", "Mark complete")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onHide}
              disabled={pending}
              className="flex w-full items-center gap-2.5 border-t border-[var(--surface-divider,#F0F0F2)] px-3 py-2 text-[13px] text-error transition-colors hover:bg-error/5 disabled:opacity-50"
            >
              <EyeOff size={13} aria-hidden="true" /> {t("إخفاء من القائمة", "Hide from list")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
