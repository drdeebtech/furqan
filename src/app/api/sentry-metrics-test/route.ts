import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

// Smoke-test endpoint: fires one of each Sentry custom metric type so you
// can verify metrics are flowing to manaracode.sentry.io/explore/metrics/.
// Not auth-gated intentionally — it emits zero sensitive data and is the
// only route we need to hit unauthenticated to verify the pipeline.
export async function GET() {
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
