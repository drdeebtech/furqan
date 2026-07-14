import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { logWarn } from "@/lib/logger";

export type SecurityAlertLevel = "info" | "warning" | "critical" | "fatal";

type SecurityAlertMetadata = Record<string, unknown>;

type SecurityAlertInput = {
  userId?: string | null;
  email?: string | null;
  attemptedAction: string;
  alertLevel: SecurityAlertLevel;
  metadata?: SecurityAlertMetadata;
};

type SecurityAlertInsert = {
  user_id: string | null;
  email: string | null;
  attempted_action: string;
  alert_level: SecurityAlertLevel;
  metadata: SecurityAlertMetadata;
};

type SecurityAlertsTable = {
  from(table: "security_alerts"): {
    insert(values: SecurityAlertInsert): Promise<{ error: { message: string } | null }>;
  };
};

export async function recordSecurityAlert(input: SecurityAlertInput): Promise<void> {
  try {
    const row: SecurityAlertInsert = {
      user_id: input.userId ?? null,
      email: input.email ?? null,
      attempted_action: input.attemptedAction,
      alert_level: input.alertLevel,
      metadata: input.metadata ?? {},
    };

    const admin = createAdminClient() as unknown as SecurityAlertsTable;
    const { error } = await admin.from("security_alerts").insert(row);
    if (error) throw new Error(error.message);

    Sentry.captureMessage(`Security alert: ${input.attemptedAction}`, {
      level: input.alertLevel === "critical" || input.alertLevel === "fatal" ? "fatal" : "warning",
      tags: {
        security_event: "true",
        alert_level: input.alertLevel,
      },
      extra: row,
    });
  } catch (err) {
    logWarn("recordSecurityAlert failed", {
      tag: "security-alert",
      attemptedAction: input.attemptedAction,
      alertLevel: input.alertLevel,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
