// Shared live-session card shape for student + platform (admin) dashboards.
// Extracted from dashboard-queries.ts (#613).

export interface LiveSessionItem {
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  timeRemaining?: string;
  progressPercent?: number;
}

