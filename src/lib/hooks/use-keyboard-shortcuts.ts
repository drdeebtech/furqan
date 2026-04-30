"use client";

import { useEffect, useRef, useState } from "react";

export interface Shortcut {
  /** Single-key shortcut (e.g. "j") OR a "g s" two-key sequence. */
  combo: string;
  description: { ar: string; en: string };
  /** Optional href — navigates via window.location for hard nav. */
  href?: string;
  /** Optional handler — runs in lieu of href. */
  onTrigger?: () => void;
  /** Group label for the help overlay. */
  group: { ar: string; en: string };
}

/**
 * Lightweight, no-dep keyboard shortcut hook.
 *
 * Supports:
 *  - Single keys: "j", "?", "/"
 *  - Sequence keys: "g s" (press g, then s within 1 second)
 *
 * Skips when the user is typing in an input/textarea/contenteditable, OR
 * when a modifier key (Cmd/Ctrl/Alt) is held. Both Shift+? and / open the
 * help overlay since `?` requires Shift on most layouts.
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  const sequenceRef = useRef<{ key: string; expires: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function handler(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key;
      const now = Date.now();
      const pending = sequenceRef.current;

      // 1. Sequence completion (e.g. "g" then "s" → "g s")
      if (pending && pending.expires > now) {
        const combo = `${pending.key} ${key.toLowerCase()}`;
        const match = shortcuts.find(s => s.combo.toLowerCase() === combo);
        sequenceRef.current = null;
        if (match) {
          event.preventDefault();
          if (match.onTrigger) match.onTrigger();
          else if (match.href) window.location.assign(match.href);
        }
        return;
      }

      // 2. Sequence start — any shortcut starting with "<this key> "
      const startsSequence = shortcuts.some(s => s.combo.startsWith(`${key.toLowerCase()} `));
      if (startsSequence) {
        sequenceRef.current = { key: key.toLowerCase(), expires: now + 1000 };
        return;
      }

      // 3. Single-key match
      const direct = shortcuts.find(s => s.combo.toLowerCase() === key.toLowerCase());
      if (direct) {
        event.preventDefault();
        if (direct.onTrigger) direct.onTrigger();
        else if (direct.href) window.location.assign(direct.href);
      }
    }

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [shortcuts, enabled]);
}

/**
 * Open-state controller for a shortcuts help overlay. Toggles on `?` (Shift+/)
 * and `/`. Returns [open, setOpen].
 */
export function useShortcutsHelp(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useKeyboardShortcuts(
    [
      { combo: "?", description: { ar: "اختصارات", en: "Shortcuts" }, group: { ar: "", en: "" }, onTrigger: () => setOpen(prev => !prev) },
      { combo: "/", description: { ar: "اختصارات", en: "Shortcuts" }, group: { ar: "", en: "" }, onTrigger: () => setOpen(prev => !prev) },
      { combo: "Escape", description: { ar: "إغلاق", en: "Close" }, group: { ar: "", en: "" }, onTrigger: () => setOpen(false) },
    ],
    true,
  );
  return [open, setOpen];
}
