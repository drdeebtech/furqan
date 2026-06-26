"use client";

import { useEffect, useRef, useState } from "react";

interface UseInViewOptions {
  /** IntersectionObserver threshold. Default 0.15 — element is 15% visible. */
  threshold?: number;
  /** Root margin string. Default "0px 0px -10% 0px" — fire slightly before fully on-screen. */
  rootMargin?: string;
  /** When true, observer disconnects after the first reveal (one-shot). Default true. */
  once?: boolean;
}

/**
 * Tracks whether the returned ref's element is in the viewport.
 * Pair with the `.scroll-reveal` CSS class in globals.css:
 *
 *   const [ref, inView] = useInView();
 *   return <section ref={ref} className="scroll-reveal" data-in-view={inView} data-armed={armed}>…</section>;
 *
 * `armed` is false on the server and on the initial client render, then flips
 * to true in an effect once the IntersectionObserver is actually watching.
 * The CSS uses `[data-armed="true"][data-in-view="false"]` for the hidden
 * pre-reveal state, so SSR / no-JS / pre-hydration always shows content
 * (no FOUC) and there is no hydration mismatch.
 *
 * Defaults to one-shot reveal (no fade-back-out on scroll up) to match
 * the brand's "Refined" character — re-triggering on every scroll
 * direction change reads as restless.
 */
export function useInView<T extends HTMLElement = HTMLElement>(
  options: UseInViewOptions = {},
): [React.RefObject<T | null>, boolean, boolean] {
  const { threshold = 0.15, rootMargin = "0px 0px -10% 0px", once = true } = options;
  const ref = useRef<T>(null);
  // Initial state must be identical on server and client to avoid a
  // hydration mismatch (server has no IntersectionObserver; the browser
  // does). Start false on both, then settle the real value in an effect.
  const [inView, setInView] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    // IntersectionObserver unavailable (very old browser) — do nothing.
    // `armed` stays false, so the CSS shows content (no FOUC); `inView`
    // is irrelevant when unarmed. This avoids a setState-in-effect.
    if (typeof IntersectionObserver === "undefined") return;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(node);
    setArmed(true);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return [ref, inView, armed];
}
