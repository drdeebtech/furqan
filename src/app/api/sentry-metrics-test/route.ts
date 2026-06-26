import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/require-admin";

// Smoke-test endpoint: fires one of each Sentry custom metric type so you
// can verify metrics are flowing to manaracode.sentry.io/explore/metrics/.
// Restricted to non-production to prevent Sentry quota spam at 50k DAU,
// AND gated behind requireAdminForApi() so a non-production server
// (CI, self-hosted dev, a staging box with NODE_ENV != production) can't
// be hit unauthenticated — which would also inflate the Sentry metric quota.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "not available in production" }, { status: 404 });
  }
  const guard = await requireAdminForApi();
  if (guard instanceof NextResponse) return guard;

  Sentry.metrics.count("test_metric_count", 1, {
    attributes: { environment: process.env.NODE_ENV ?? "development" },
  });

  Sentry.metrics.distribution("test_metric_distribution", 150, {
    unit: "millisecond",
    attributes: { route: "/api/sentry-metrics-test" },
  });

  Sentry.metrics.gauge("test_metric_gauge", 42, {
    attributes: { source: "api" },
  });

  return NextResponse.json({
    success: true,
    message: "Sentry metrics sent successfully",
    metrics_sent: [
      "test_metric_count (counter)",
      "test_metric_distribution (distribution, ms)",
      "test_metric_gauge (gauge)",
    ],
    note: "metrics.set was removed in @sentry/nextjs v10 — count/distribution/gauge are the stable API",
  });
}
