/**
 * loudAction — wraps server actions so that *every* failure is observable.
 *
 * Replaces the silent-fail anti-pattern where a server action discards its
 * Supabase { error } result and returns success. With this wrapper:
 *   - Every error is logged via logError (Sentry / console / file).
 *   - Critical errors (severity='critical') fire a Telegram alert.
 *   - The audit_log row is written regardless of outcome (success OR failure).
 *   - The caller always receives a consistent { ok, error?, message? } shape.
 *
 * Usage:
 *   export const myAction = loudAction({
 *     name: 'admin.archive-teacher',
 *     audit: { table: 'teacher_profiles', recordId: t => t.teacherId, action: 'UPDATE' },
 *     severity: 'warning',
 *     handler: async ({ teacherId }) => {
 *       const supabase = await createClient();
 *       const { error } = await supabase
 *         .from('teacher_profiles')
 *         .update({ is_archived: true } as never)
 *         .eq('teacher_id', teacherId);
 *       if (error) throw error;            // wrapper captures + logs
 *       return { message: 'تم الأرشفة' };  // wrapper returns { ok: true, message }
 *     },
 *   });
 *
 * The `as never` cast on inserts/updates is preserved (project pattern), but
 * the result is now always destructured — silent fail becomes structurally
 * impossible inside a loudAction handler.
 */
import "server-only";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { logError } from "@/lib/logger";

export type LoudResult = {
  ok: true;
  message?: string;
} | {
  ok: false;
  error: string;
};

type Severity = "info" | "warning" | "critical";

interface AuditConfig<TInput> {
  table: string;
  recordId: string | ((input: TInput) => string);
  action: "INSERT" | "UPDATE" | "DELETE";
  reasonPrefix?: string;
}

interface LoudActionConfig<TInput, THandlerResult extends void | { message?: string }> {
  /** Stable name for logs/audit/Telegram, e.g. 'admin.archive-teacher'. */
  name: string;
  /** Severity tier for alerting. 'critical' triggers Telegram. */
  severity?: Severity;
  /** Optional audit_log entry — written on success AND failure. */
  audit?: AuditConfig<TInput>;
  /** The actual work. Throw to fail loudly; return optional message on success. */
  handler: (input: TInput, ctx: { actorId: string | null }) => Promise<THandlerResult>;
  /** Optional auth check before handler runs. Throw to reject. */
  preflight?: () => Promise<{ actorId: string | null }>;
}

export function loudAction<TInput, THandlerResult extends void | { message?: string }>(
  config: LoudActionConfig<TInput, THandlerResult>,
): (input: TInput) => Promise<LoudResult> {
  return async (input: TInput) => {
    // Drop a breadcrumb so any error captured later in this request includes
    // the action name in its trail. setTag pins action.name + action.severity
    // onto the current scope for the duration of the handler.
    Sentry.addBreadcrumb?.({
      category: "action",
      level: "info",
      message: config.name,
      data: { severity: config.severity ?? "info" },
    });
    Sentry.setTag?.("action.name", config.name);
    Sentry.setTag?.("action.severity", config.severity ?? "info");

    let actorId: string | null = null;
    try {
      if (config.preflight) {
        const r = await config.preflight();
        actorId = r.actorId;
      }
      const result = await config.handler(input, { actorId });
      const message = (result && typeof result === "object" && "message" in result)
        ? result.message
        : undefined;
      // Audit on success.
      if (config.audit) {
        await writeAudit(config.audit, input, actorId, "success", null);
      }
      return { ok: true, message };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError(`loudAction[${config.name}] failed`, err, {
        tag: "loud-action",
        actionName: config.name,
        severity: config.severity ?? "info",
      });

      if (config.severity === "critical") {
        await sendTelegramAlert(
          `🚨 <b>Critical action failed</b>\n\n<b>Action:</b> ${config.name}\n<b>Error:</b> ${escapeHtml(message)}`,
        ).catch(() => { /* don't double-fail */ });
      }
      // Audit on failure too — silent failure is the bug we're killing.
      if (config.audit) {
        await writeAudit(config.audit, input, actorId, "failure", message).catch((auditErr) =>
          logError("loudAction audit write failed (failure path)", auditErr, {
            tag: "loud-action",
            actionName: config.name,
          }),
        );
      }
      return { ok: false, error: message };
    }
  };
}

async function writeAudit<TInput>(
  audit: AuditConfig<TInput>,
  input: TInput,
  actorId: string | null,
  outcome: "success" | "failure",
  errorMessage: string | null,
) {
  try {
    const recordId = typeof audit.recordId === "function" ? audit.recordId(input) : audit.recordId;
    const admin = createAdminClient();
    await admin.from("audit_log").insert({
      changed_by: actorId,
      table_name: audit.table,
      record_id: recordId,
      action: audit.action,
      old_data: null,
      new_data: outcome === "success" ? { input } : null,
      reason: outcome === "success"
        ? `${audit.reasonPrefix ?? "loudAction"} OK`
        : `${audit.reasonPrefix ?? "loudAction"} FAILED: ${errorMessage}`,
    } as never);
  } catch (err) {
    logError("loudAction audit write failed", err, { tag: "loud-action" });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
