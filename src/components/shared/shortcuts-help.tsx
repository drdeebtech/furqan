"use client";

import { Keyboard, X } from "lucide-react";
import { useEffect } from "react";
import { useLang } from "@/lib/i18n/context";
import type { Shortcut } from "@/lib/hooks/use-keyboard-shortcuts";

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
  shortcuts: Shortcut[];
}

export function ShortcutsHelp({ open, onClose, shortcuts }: ShortcutsHelpProps) {
  const { t, lang } = useLang();

  // Trap focus on open + restore on close. Prevents body scroll while open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  // Group shortcuts by their group label.
  const groups = new Map<string, Shortcut[]>();
  for (const s of shortcuts) {
    const label = lang === "ar" ? s.group.ar : s.group.en;
    if (!label) continue;
    const list = groups.get(label) ?? [];
    list.push(s);
    groups.set(label, list);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-help-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("إغلاق", "Close")}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-card shadow-[0_24px_48px_rgba(0,0,0,0.25)]">
        <div className="flex items-center gap-3 border-b border-[var(--surface-border)] px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold/10 text-gold">
            <Keyboard size={18} aria-hidden="true" />
          </div>
          <h2 id="shortcuts-help-title" className="font-display text-lg font-bold">
            {t("اختصارات لوحة المفاتيح", "Keyboard shortcuts")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("إغلاق", "Close")}
            className="ms-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-foreground/5 hover:text-foreground focus-ring"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {[...groups.entries()].map(([groupLabel, list]) => (
            <section key={groupLabel} className="mb-5 last:mb-0">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-light">
                {groupLabel}
              </h3>
              <ul className="space-y-1.5">
                {list.map((s) => (
                  <li key={s.combo} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5">
                    <span className="text-sm text-foreground">
                      {lang === "ar" ? s.description.ar : s.description.en}
                    </span>
                    <KeyChips combo={s.combo} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="border-t border-[var(--surface-border)] px-5 py-3 text-[11px] text-muted-light">
          {t(
            "اضغط ؟ في أي وقت لفتح هذه القائمة — Esc للإغلاق",
            "Press ? anytime to reopen this panel — Esc to close",
          )}
        </p>
      </div>
    </div>
  );
}

function KeyChips({ combo }: { combo: string }) {
  const parts = combo.split(" ");
  return (
    <span className="flex items-center gap-1">
      {parts.map((part, i) => (
        <kbd
          key={i}
          className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-md border border-[var(--surface-border)] bg-[var(--surface-light)] px-1.5 font-mono text-[11px] font-medium text-foreground"
        >
          {part}
        </kbd>
      ))}
    </span>
  );
}
