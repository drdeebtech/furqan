/**
 * loudAction — wraps server actions so that *every* failure is observable.
 *
 * Replaces the silent-fail anti-pattern where a server action discards its
 * Supabase { error } result and returns success. With this wrapper:
 *   - Every SYSTEM error is logged via logError (Sentry / console / file).
 *   - Critical SYSTEM errors (severity='critical') fire a Telegram alert.
 *   - The audit_log row is written on success and on system-failure.
 *   - The caller always receives a consistent { ok, error?, message? } shape.
 *
 * UserError exceptions (see `userError` duck-type below):
 *
 *   - `throw new UserError("غير مصرح")` — pure preflight/validation. NOT a
 *     system error: skip Sentry / Telegram / FAILED audit. The user sees the
 *     message; ops sees nothing because there's nothing to fix.
 *
 *   - `throw new UserError("فشل حفظ", { cause: supabaseError })` — wraps a
 *     system error. The cause is logged to Sentry as a system failure (and
 *     Telegram on severity=critical, FAILED audit row), but the USER still
 *     sees the friendly Arabic message. Use this for any throw that follows
 *     `if (supabaseError)` / `if (storageError)` / `if (dailyApiError)`.
 *
 * Usage:
 *   export const myAction = loudAction({
 *     name: 'admin.archive-teacher',
 *     audit: { table: 'teacher_profiles', recordId: t => t.teacherId, action: 'UPDATE' },
 *     severity: 'warning',
 *     // Optional: validate shape before any side-effect runs. Failures
 *     // return { ok: false, error } without firing Sentry/Telegram/audit.
 *     schema: z.object({ teacherId: z.string().uuid() }),
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
import { after } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import * as Sentry from "@sentry/nextjs";
import type { ZodType } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramAlert } from "@/lib/n8n/client";
import { logError } from "@/lib/logger";
import { attachGeoToSentryScope } from "@/lib/sentry-geo";
import { escapeHtml } from "@/lib/security/sanitize";

export type LoudResult = {
  ok: true;
  message?: string;
} | {
  ok: false;
  error: string;
};

/**
 * Minimal user-facing Error with the `userError` duck-type flag the framework
 * looks for in its catch block. Use this when constructing UserError-shaped
 * throws from helpers (like `notFoundOrInfra`) that don't have access to a
 * per-file `UserError` class.
 *
 * Per-file `class UserError extends Error` declarations across the codebase
 * are equivalent — they all set `readonly userError = true` and accept the
 * same `(msg, options?)` constructor signature. The framework duck-types,
 * so any of them work.
 */
function loudUserError(msg: string, options?: { cause?: unknown }): Error {
  const err = new Error(msg, options) as Error & { userError: true };
  err.name = "UserError";
  err.userError = true;
  return err;
}

/**
 * Distinguish supabase-js's "row not found" code (PGRST116) from real
 * infrastructure failures. Returns a UserError-shaped throw target:
 *
 *   - PGRST116 / null err → plain UserError (silent passthrough — admins
 *     typing in non-existent IDs shouldn't ping Sentry on every miss)
 *
 *   - any other code (network, RLS regression, schema mismatch) → UserError
 *     with `cause` attached so the framework's catch routes the underlying
 *     error to Sentry / Telegram (on critical) / FAILED audit
 *
 * Usage:
 *   const { data: hw, error: hwErr } = await supabase.from("...").single();
 *   if (hwErr || !hw) throw notFoundOrInfra(hwErr, "المتابعة غير موجودة");
 *
 * The narrow input type covers PostgrestError + plain Error + null.
 */
export function notFoundOrInfra(
  err: { code?: string; message?: string } | null | undefined,
  friendly: string,
): Error {
  if (!err || err.code === "PGRST116") {
    return loudUserError(friendly);
  }
  return loudUserError(friendly, { cause: err });
}

type Severity = "info" | "warning" | "critical";

interface AuditConfig<TInput> {
  table: string;
  /**
   * The audited row's UUID, or `null` when the action has no single-row target
   * — bulk operations (control-tower) and key-based tables (platform_settings).
   * `audit_log.record_id` is a nullable uuid; writing a non-UUID sentinel there
   * raised 22P02. For null targets the human-readable subject lives in `reason`.
   */
  recordId: string | null | ((input: TInput, actorId: string | null) => string | null);
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
  /**
   * Optional zod schema. When provided, input is validated *before* the
   * handler runs. Validation failures return { ok: false, error } without
   * triggering Telegram alerts or audit_log writes (user input mistakes are
   * not system failures). Field-level messages are joined with ' • '.
   */
  schema?: ZodType<TInput>;
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
    // Stream 12C — geo tags from Vercel-injected headers so Sentry events
    // captured anywhere in this action's call tree are filterable by
    // country/region/city in the Sentry UI. await is fire-and-forget
    // safe — the helper swallows its own errors.
    await attachGeoToSentryScope();

    let actorId: string | null = null;
    try {
      // Validate input shape before any side-effect / DB call. Validation
      // failures are user-input errors, not system failures: no Telegram, no
      // audit_log row, no Sentry.captureException.
      let validatedInput = input;
      if (config.schema) {
        const parsed = config.schema.safeParse(input);
        if (!parsed.success) {
          const errorMessage = parsed.error.issues
            .map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`)
            .join(" • ");
          return { ok: false, error: `بيانات غير صالحة — ${errorMessage}` };
        }
        validatedInput = parsed.data;
      }
      if (config.preflight) {
        const r = await config.preflight();
        actorId = r.actorId;
      }
      const result = await config.handler(validatedInput, { actorId });
      const message = (result && typeof result === "object" && "message" in result)
        ? result.message
        : undefined;
      // Audit on success — flushed via Next.js after() so the response ships
      // before the audit_log insert completes (~50-150ms shaved off TTFB).
      if (config.audit) {
        const auditConfig = config.audit;
        after(() => writeAudit(auditConfig, input, actorId, "success", null));
      }
      return { ok: true, message };
    } catch (err) {
      // Next.js implements redirect() and notFound() by throwing tagged
      // errors that the framework catches at the response boundary. They
      // are NOT failures — silencing them in our catch would convert a
      // successful redirect into a fake { ok: false, error } and strand
      // the caller. Re-throw so the framework sees the throw. Treat as
      // SUCCESS for audit purposes: handlers that redirect have already
      // performed their work (e.g. switchActiveRole writes profiles.role
      // before redirecting). Skip Sentry / Telegram entirely — redirect
      // is not an anomaly. If a handler wants to audit a failure-recovery
      // redirect path explicitly, it can call logError itself before
      // calling redirect(); that telemetry survives this branch.
      if (isRedirectError(err)) {
        if (config.audit) {
          const auditConfig = config.audit;
          after(() => writeAudit(auditConfig, input, actorId, "success", null));
        }
        throw err;
      }

      // UserError handling — duck-typed on the `userError === true` flag so a
      // single shared class (src/lib/actions/user-error.ts) works across all
      // callers. (Historically each action file declared its own UserError and
      // cross-file instanceof only matched by luck; the canonical class fixed
      // that, but the duck-type is kept for the `loudUserError` helper below.)
      //
      // Two sub-cases:
      //
      //   1. UserError WITHOUT cause — pure preflight/validation failure
      //      (auth denial, "not found", required field). Skip Sentry,
      //      Telegram, FAILED audit row. The user sees the friendly
      //      message; ops sees nothing because there's nothing to fix.
      //
      //   2. UserError WITH cause — wraps a system error (Supabase, Daily,
      //      storage, etc). Log the cause to Sentry, fire Telegram on
      //      critical severity, and write the FAILED audit row using the
      //      cause's message. The USER still sees the UserError's friendly
      //      Arabic message — but ops sees the underlying infrastructure
      //      failure for diagnosis.
      //
      // To use case 2, throw with the standard ES2022 cause option:
      //   throw new UserError("فشل ...", { cause: supabaseError });
      if (err instanceof Error && (err as { userError?: boolean }).userError === true) {
        const cause = (err as { cause?: unknown }).cause;
        if (cause !== undefined) {
          const causeMessage = cause instanceof Error ? cause.message : String(cause);
          logError(`loudAction[${config.name}] failed (user-facing wrap)`, cause, {
            tag: "loud-action",
            actionName: config.name,
            severity: config.severity ?? "info",
          });
          if (config.severity === "critical") {
            after(() =>
              sendTelegramAlert(
                `🚨 <b>Critical action failed</b>\n\n<b>Action:</b> ${config.name}\n<b>User-facing:</b> ${escapeHtml(err.message)}\n<b>Cause:</b> ${escapeHtml(causeMessage)}`,
              ).catch(() => { /* don't double-fail */ }),
            );
          }
          if (config.audit) {
            const auditConfig = config.audit;
            after(() =>
              writeAudit(auditConfig, input, actorId, "failure", causeMessage).catch((auditErr) =>
                logError("loudAction audit write failed (failure path)", auditErr, {
                  tag: "loud-action",
                  actionName: config.name,
                }),
              ),
            );
          }
        }
        return { ok: false, error: err.message };
      }

      const message = err instanceof Error ? err.message : String(err);
      logError(`loudAction[${config.name}] failed`, err, {
        tag: "loud-action",
        actionName: config.name,
        severity: config.severity ?? "info",
      });

      if (config.severity === "critical") {
        // Telegram alert deferred to after() — caller sees the error response
        // immediately; alert delivery happens in the background.
        after(() =>
          sendTelegramAlert(
            `🚨 <b>Critical action failed</b>\n\n<b>Action:</b> ${config.name}\n<b>Error:</b> ${escapeHtml(message)}`,
          ).catch(() => { /* don't double-fail */ }),
        );
      }
      // Audit on failure too — silent failure is the bug we're killing.
      if (config.audit) {
        const auditConfig = config.audit;
        after(() =>
          writeAudit(auditConfig, input, actorId, "failure", message).catch((auditErr) =>
            logError("loudAction audit write failed (failure path)", auditErr, {
              tag: "loud-action",
              actionName: config.name,
            }),
          ),
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
    const recordId = typeof audit.recordId === "function" ? audit.recordId(input, actorId) : audit.recordId;
    // admin: framework audit_log writer — actorId may be null; audit_log is service-role telemetry (issue #523)
    const admin = createAdminClient();
    await admin.from("audit_log").insert({
      changed_by: actorId,
      table_name: audit.table,
      record_id: recordId,
      action: audit.action,
      old_data: null,
      // The cast is the one Phase 4a retention: writeAudit is generic over
      // TInput (any handler input shape), so TypeScript can't prove the
      // wrapper { input } satisfies the Json union type that audit_log.new_data
      // expects. Postgres jsonb coerces at runtime; the cast bridges the
      // type/runtime gap for this single generic-payload case.
      new_data: outcome === "success" ? ({ input } as never) : null,
      reason: outcome === "success"
        ? `${audit.reasonPrefix ?? "loudAction"} OK`
        : `${audit.reasonPrefix ?? "loudAction"} FAILED: ${errorMessage}`,
    });
  } catch (err) {
    logError("loudAction audit write failed", err, { tag: "loud-action" });
  }
}

// escapeHtml is imported from @/lib/security/sanitize (single source for the
// five-char HTML escape used in Telegram alert payloads above).
