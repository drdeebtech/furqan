"use client";

import { RouteErrorBoundary } from "@/components/shared/route-error";

export default function StudentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} route="student" homeHref="/student/dashboard" />;
}
