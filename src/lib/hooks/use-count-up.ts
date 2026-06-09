"use client";

import { useEffect, useRef, useState } from "react";

interface UseCountUpOptions {
  /** Total animation duration in ms. Default 600 (per .impeccable.md motion budget). */
  durationMs?: number;
  /** Skip the animation when true. Used by the prefers-reduced-motion guard. */
  disabled?: boolean;
}

/**
 * Brand-aligned easing for the StatCard count-up.
 *
 * The curve sets the *personality* of the tick — linear reads mechanical
 * (cash register), ease-in feels lazy, bounce/elastic feels playful and
 * violates .impeccable.md ("Progress is celebrated quietly, not gamified").
 *
 * The right curve for FURQAN should feel **decisive but calm** — the
 * number arrives confidently then settles, mirroring how a teacher
 * pronounces a final answer.
 */
function easeProgress(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animate an integer from 0 → target on mount and on target change.
 * Returns the current displayed value (integer). Respects
 * prefers-reduced-motion by skipping the animation entirely.
 */
export function useCountUp(target: number, options: UseCountUpOptions = {}): number {
  const { durationMs = 600, disabled = false } = options;
  const [value, setValue] = useState<number>(() => (disabled ? target : 0));
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef<number>(0);

  useEffect(() => {
    if (disabled || prefersReducedMotion()) {
      // Sync to new target without animating. setState-in-effect is correct
      // here: we're propagating an external prop change to displayed state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(target);
      return;
    }

    fromRef.current = value;
    startRef.current = null;

    const tick = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = easeProgress(progress);
      const current = Math.round(fromRef.current + (target - fromRef.current) * eased);
      setValue(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, disabled]);

  return value;
}
