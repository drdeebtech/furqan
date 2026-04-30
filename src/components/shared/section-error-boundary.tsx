"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/nextjs";

interface Props {
  fallbackLabel: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  retryKey: number;
}

/**
 * Per-section error boundary. When a single dashboard widget throws, only
 * that widget collapses to a small fallback — the rest of the dashboard
 * stays usable. Keeps with the "no silent failures" rule by routing the
 * caught error through Sentry.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, retryKey: 0 };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, retryKey: 0 };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.withScope((scope) => {
      scope.setTag("source", "student-dashboard-section");
      scope.setExtra("componentStack", info.componentStack);
      Sentry.captureException(error);
    });
  }

  retry = () => {
    this.setState((s) => ({ hasError: false, retryKey: s.retryKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-2xl border border-warning/30 bg-warning/5 p-4 text-sm sm:flex-row sm:items-center sm:gap-3"
        >
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
            <AlertTriangle size={16} aria-hidden="true" />
          </span>
          <p className="min-w-0 flex-1 text-foreground">{this.props.fallbackLabel}</p>
          <button
            type="button"
            onClick={this.retry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-warning/30 px-3 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning/10 focus-ring"
          >
            <RefreshCw size={12} aria-hidden="true" />
            <span>إعادة المحاولة · Retry</span>
          </button>
        </div>
      );
    }

    return <div key={this.state.retryKey}>{this.props.children}</div>;
  }
}
