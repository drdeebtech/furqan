"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function SentryMetricsTest() {
  useEffect(() => {
    Sentry.metrics.count("client_page_view", 1, {
      attributes: {
        page: "metrics_test",
        environment: process.env.NODE_ENV ?? "development",
      },
    });
  }, []);

  const handleTestClick = () => {
    Sentry.metrics.count("client_button_click", 1, {
      attributes: { button: "test_metrics" },
    });
    alert("Client metric sent! Check Sentry → Explore → Metrics");
  };

  return (
    <div className="glass-card p-5 m-5 max-w-sm">
      <h3 className="text-white font-bold mb-2">Sentry Metrics Test</h3>
      <p className="text-white/60 text-sm mb-4">
        Client-side metric fired on page load.
      </p>
      <button
        onClick={handleTestClick}
        className="glass glass-gold px-4 py-2 text-sm rounded"
      >
        Send Client Metric
      </button>
    </div>
  );
}
