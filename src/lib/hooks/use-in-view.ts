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
 *   return <section ref={ref} className="scroll-reveal" data-in-view={inView}>…</section>;
 *
 * Defaults to one-shot reveal (no fade-back-out on scroll up) to match
 * the brand's "Refined" character — re-triggering on every scroll
 * direction change reads as restless.
 */
export function useInView<T extends HTMLElement = HTMLElement>(
  options: UseInViewOptions = {},
): [React.RefObject<T | null>, boolean] {
  const { threshold = 0.15, rootMargin = "0px 0px -10% 0px", once = true } = options;
  const ref = useRef<T>(null);
  // Default in-view = true when IntersectionObserver is unavailable (SSR
  // initial render, very old browsers). Avoids a setState-in-effect cascade
  // and ensures content is visible without the observer.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") return;

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
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return [ref, inView];
}
