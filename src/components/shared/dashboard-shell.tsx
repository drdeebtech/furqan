import type { ReactNode } from "react";

interface DashboardShellProps {
  /** Optional anchor id, e.g. "student-main" so skip-links work. */
  id?: string;
  /**
   * Optional dir override. Default: inherit from parent <html>. Loading
   * skeletons should leave this unset so the wrong-direction flicker that
   * hardcoded `dir="rtl"` causes for English users disappears.
   */
  dir?: "rtl" | "ltr";
  /**
   * 'default' — main page padding (py-8 sm:py-10).
   * 'compact' — streamed-section padding (pb-2). Used by the wrappers in
   *             page.tsx that bracket Suspense boundaries.
   */
  paddingY?: "default" | "compact";
  className?: string;
  children: ReactNode;
}

/**
 * Canonical dashboard width container — `mx-auto max-w-7xl px-4 sm:px-6`
 * with role-appropriate vertical padding.
 *
 * Eliminates the 3-site width drift the audit flagged (admin loading.tsx:7
 * + moderator loading.tsx:7 hardcoded `max-w-6xl` while their pages use
 * `max-w-7xl`; teacher streamed sections at page.tsx:226-251 the same).
 * One shell, every page.tsx + loading.tsx consumes it, layout shift on
 * hydration goes away.
 *
 * Server-renderable.
 */
export function DashboardShell({
  id,
  dir,
  paddingY = "default",
  className,
  children,
}: DashboardShellProps) {
  const py = paddingY === "compact" ? "pb-2" : "py-8 sm:py-10";
  return (
    <div
      id={id}
      dir={dir}
      className={`mx-auto max-w-7xl px-4 ${py} sm:px-6 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
