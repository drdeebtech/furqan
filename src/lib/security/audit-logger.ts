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

const SECURITY_ALERT_THROTTLE_MS = 60_000;
const SECURITY_ALERT_THROTTLE_PRUNE_SIZE = 500;
const recentSecurityAlerts = new Map<string, number>();

export async function recordSecurityAlert(input: SecurityAlertInput): Promise<void> {
  try {
    const now = Date.now();
    const throttleKey = `${input.attemptedAction}:${input.userId ?? input.email ?? "anon"}`;
    const lastFiredAt = recentSecurityAlerts.get(throttleKey);
    if (lastFiredAt !== undefined && now - lastFiredAt < SECURITY_ALERT_THROTTLE_MS) {
      return;
    }
    recentSecurityAlerts.set(throttleKey, now);
    if (recentSecurityAlerts.size > SECURITY_ALERT_THROTTLE_PRUNE_SIZE) {
      for (const [key, firedAt] of recentSecurityAlerts) {
        if (now - firedAt >= SECURITY_ALERT_THROTTLE_MS) recentSecurityAlerts.delete(key);
      }
    }

    const row: SecurityAlertInsert = {
      user_id: input.userId ?? null,
      email: input.email ?? null,
      attempted_action: input.attemptedAction,
      alert_level: input.alertLevel,
      metadata: input.metadata ?? {},
    };
    const sentryExtra = {
      user_id: row.user_id,
      attempted_action: row.attempted_action,
      alert_level: row.alert_level,
      metadata: row.metadata,
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
      extra: sentryExtra,
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
