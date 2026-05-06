"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shared 'now' clock for dashboard widgets.
 *
 * Returns a Date updated every `intervalMs` (default 60_000ms). Pauses while
 * the tab is hidden via the Page Visibility API and snaps to the real time
 * on visibility return — a backgrounded tab shows accurate "X minutes ago"
 * the instant the user comes back, with no stale-clock catch-up flicker.
 *
 * Replaces the per-component setInterval+setNow pattern that historically
 * spawned 8 independent 60s timers across the four role dashboards (student,
 * teacher, admin, moderator dashboard-content + their next-action banners +
 * teacher-session-card). One hook, one timer per page, one re-render per
 * minute per page instead of one per component.
 *
 * Pass `initial` (a Date or epoch ms) to seed the first render — typically
 * the page's `renderedAtMs` from the server component — so SSR HTML matches
 * the first client render exactly and there's no hydration mismatch. The
 * seeded value is preserved across the first start; subsequent re-starts
 * (after a visibility-hidden→visible transition) snap to real time.
 */
export function useNowTicker(intervalMs: number = 60_000, initial?: Date | number): Date {
  const [now, setNow] = useState<Date>(() => {
    if (initial == null) return new Date();
    return initial instanceof Date ? initial : new Date(initial);
  });
  const isFirstStartRef = useRef(true);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id !== null) return;
      if (!isFirstStartRef.current) setNow(new Date());
      isFirstStartRef.current = false;
      id = setInterval(() => setNow(new Date()), intervalMs);
    };

    const stop = () => {
      if (id === null) return;
      clearInterval(id);
      id = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  return now;
}
