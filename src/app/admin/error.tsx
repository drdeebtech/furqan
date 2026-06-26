"use client";

import { RouteErrorBoundary } from "@/components/shared/route-error";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} route="admin" homeHref="/admin/dashboard" />;
}
