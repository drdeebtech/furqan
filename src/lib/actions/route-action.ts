/**
 * routeAction — the route-adapter envelope, absorbed into one factory.
 *
 * Background. A route adapter (CONTEXT.md: the route-colocated `actions.ts`
 * that owns the HTTP/FormData/auth boundary) repeats the same envelope ~25
 * times across `src/app/**​/actions.ts`:
 *
 *   class UserError extends Error { readonly userError = true; ... }   // ← 22×
 *   async function adminPreflight() {
 *     try { const { id } = await requireAdmin(); return { actorId: id }; }
 *     catch (e) {
 *       if (e instanceof ForbiddenError) throw new UserError("ليس لديك صلاحية");
 *       throw e;
 *     }
 *   }
 *   const base = loudAction({ ..., preflight: adminPreflight, handler });
 *   export async function thing(...) {
 *     const r = await base(input);
 *     if (!r.ok) return { error: r.error };
 *     return { success: true };
 *   }
 *
 * `routeAction` folds the auth preflight into the loudAction config. Callers
 * declare a `role` instead of hand-rolling `adminPreflight`, and use the one
 * shared `UserError` (`./user-error`) instead of a per-file class.
 *
 * What it does NOT change (deliberately, per ADR-0001 / ADR-0002):
 *   - `requireRole` stays the auth primitive. routeAction calls it; it does
 *     not replace or re-implement the auth seam.
 *   - The failure contract is `loudAction`'s `{ ok, error?, message? }` — the
 *     same shape `<ActionFeedback />` and every `useActionState` form already
 *     read. routeAction layers ON TOP of loudAction; it is not a parallel
 *     wrapper.
 *   - Order of operations matches loudAction: schema validation first, then
 *     the auth preflight, then the handler. (Behavior-preserving — the
 *     existing hand-rolled `adminPreflight` adapters already rely on this.)
 *
 * Auth denial is surfaced the way loudAction wants it: `requireRole` throws
 * `ForbiddenError` (or its subclass `UnauthenticatedError`), which routeAction
 * converts to a *cause-less* `UserError`. loudAction then treats it as a pure
 * preflight failure — friendly message to the user, NO Sentry / Telegram /
 * FAILED audit row. A non-Forbidden throw from `requireRole` (a real infra
 * failure mid-auth) is re-thrown untouched so loudAction logs it as a system
 * error.
 */
import "server-only";
import { loudAction, type LoudResult } from "@/lib/actions/loud";
import { requireRole, ForbiddenError } from "@/lib/auth/require-admin";
import { UserError } from "@/lib/actions/user-error";
import type { UserRole } from "@/types/database";
import type { ZodType } from "zod";

/** Friendly Arabic message shown when the active role lacks permission. */
const FORBIDDEN_MESSAGE = "ليس لديك صلاحية";

interface RouteAuditConfig<TInput> {
  table: string;
  recordId: string | ((input: TInput, actorId: string | null) => string);
  action: "INSERT" | "UPDATE" | "DELETE";
  reasonPrefix?: string;
}

interface RouteActionConfig<TInput, THandlerResult extends void | { message?: string }> {
  /** Stable name for logs/audit/Telegram, e.g. 'admin.reviews.delete'. */
  name: string;
  /**
   * Role(s) gated at the boundary. A single role mirrors `requireRole(role)`;
   * an array mirrors `requireRole([...])` (any-of). The matched id is passed
   * to the handler via `ctx.actorId`.
   */
  role: UserRole | readonly UserRole[];
  /** Severity tier for alerting. 'critical' triggers Telegram. */
  severity?: "info" | "warning" | "critical";
  /** Optional zod schema. Validated before the auth preflight runs. */
  schema?: ZodType<TInput>;
  /** Optional audit_log entry — written on success AND system-failure. */
  audit?: RouteAuditConfig<TInput>;
  /** The actual work. Throw to fail loudly; return optional message on success. */
  handler: (input: TInput, ctx: { actorId: string | null }) => Promise<THandlerResult>;
}

/**
 * Build a route adapter. Returns a thin caller `(input) => Promise<LoudResult>`
 * — identical in shape to `loudAction`'s return, so existing call sites that
 * map `{ ok, error }` onto a form result need no changes.
 */
export function routeAction<TInput, THandlerResult extends void | { message?: string }>(
  config: RouteActionConfig<TInput, THandlerResult>,
): (input: TInput) => Promise<LoudResult> {
  const { role, ...rest } = config;
  return loudAction<TInput, THandlerResult>({
    ...rest,
    preflight: async () => {
      try {
        // requireRole's overloads: single role → { id }; array → { id, role }.
        // Both carry `id`; that's all the preflight contract needs.
        const authed = Array.isArray(role)
          ? await requireRole(role as readonly UserRole[])
          : await requireRole(role as UserRole);
        return { actorId: authed.id };
      } catch (e) {
        // ForbiddenError (and its UnauthenticatedError subclass) are auth
        // denials — surface as a cause-less UserError so loudAction does the
        // silent passthrough (no Sentry / Telegram / FAILED audit). Anything
        // else is a real failure mid-auth: re-throw so loudAction logs it.
        if (e instanceof ForbiddenError) throw new UserError(FORBIDDEN_MESSAGE);
        throw e;
      }
    },
  });
}
