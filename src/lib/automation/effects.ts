/**
 * Declared domain-event → in-app-notification map (notify fan-out locality).
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every domain action used to hand-assemble its own `notify(...)` payload
 * inline next to its `emitEvent(...)` call (~80 sites). "What in-app
 * notifications fire when event X happens" had no single home, so paths
 * drifted: an admin path and a teacher path for the same logical event would
 * notify different recipients (or one would forget to notify at all). This
 * module makes the consequent in-app notifications of an event *declarative
 * data* in one place, so the answer to "what fires on event X" is a lookup,
 * not a grep.
 *
 * LAYERING
 * ────────
 * This sits ABOVE the existing primitives, it does not replace them:
 *   - `emitEvent` (src/lib/automation/emit.ts) stays the n8n transport. It is
 *     fire-and-forget and is NOT touched here. Effects declared below are the
 *     *in-app* fan-out only; the n8n side (parent reports, etc.) still flows
 *     through `emitEvent` underneath at the call site.
 *   - `notify` (src/lib/notifications/dispatcher.ts) stays the single in-app
 *     dispatcher. `dispatchEffects` fans out THROUGH it — one `notify(...)`
 *     call per declared effect.
 *
 * SCOPE (incremental migration)
 * ─────────────────────────────
 * Only a few events are declared here today (the clear single-recipient ones).
 * The rest still hand-roll their notify fan-out at the call site. Migrating an
 * event = moving its inline `notify(...)` into `EVENT_EFFECTS[event]` and
 * replacing the call site with `dispatchEffects(event, ctx)`. See the
 * follow-up note at the bottom of this file.
 *
 * BEHAVIOUR PRESERVATION
 * ──────────────────────
 * `dispatchEffects` is best-effort and never throws to the caller — same
 * contract the inline `notify(...)` calls had (each was wrapped in a
 * try/catch + logError, or `Promise.allSettled`). A failed in-app notification
 * must never block or fail the domain action that already committed.
 */

import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import type { NotifType } from "@/types/database";
import type { FurqanEvent } from "./emit";

/**
 * Context passed to `dispatchEffects` for an event. Effect resolvers below read
 * the fields they need to pick the recipient and build the (Arabic) copy. Kept
 * loose so each event can carry its own shape without a union explosion; the
 * per-event resolvers narrow what they read.
 */
export type EffectContext = Record<string, unknown> & {
  entityType?: string;
  entityId?: string;
};

/**
 * One consequent in-app notification of an event, resolved from context.
 * Returning `null` means "no notification for this recipient given this
 * context" (e.g. a missing recipient id) — the dispatcher skips it silently,
 * matching the old inline guards.
 */
export interface ResolvedEffect {
  userId: string;
  type: NotifType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  urgent?: boolean;
}

/** A declared effect: a pure function from event context to a notification. */
export type EffectResolver = (ctx: EffectContext) => ResolvedEffect | null;

// ─── Declared event → in-app effects ─────────────────────────────────────────
//
// Each FurqanEvent maps to the list of in-app notifications it fans out. The
// recipient, NotifType, and Arabic copy live here as data (resolved from
// context), so "what notifications fire on event X" is one lookup.

export const EVENT_EFFECTS: Partial<Record<FurqanEvent, EffectResolver[]>> = {
  // A student booked a session → notify the teacher to confirm it.
  // (Migrated from src/app/student/bookings/new/actions.ts.)
  "booking.created": [
    (ctx) => {
      const teacherId = asId(ctx.teacherId);
      if (!teacherId) return null;
      const dateLabel = typeof ctx.dateLabel === "string" ? ctx.dateLabel : "";
      return {
        userId: teacherId,
        type: "booking",
        title: "حجز جديد",
        body: `لديك حجز جديد بتاريخ ${dateLabel} — يرجى التأكيد`,
        entityType: "booking",
        entityId: asId(ctx.entityId) ?? undefined,
      };
    },
  ],

  // A teacher assigned follow-up → notify the student.
  // (Dispatched from the follow-up domain: src/lib/domains/follow-up/actions.ts
  // createFollowUp, which the homework.ts route adapter delegates to.)
  "homework.assigned": [
    (ctx) => {
      const studentId = asId(ctx.studentId);
      if (!studentId) return null;
      const title = typeof ctx.title === "string" ? ctx.title : "";
      return {
        userId: studentId,
        type: "homework",
        title: "متابعة جديدة",
        body: `كلّفك معلمك بمتابعة جديدة — ${title}`,
        entityType: "homework",
        entityId: asId(ctx.entityId) ?? undefined,
      };
    },
  ],
};

/**
 * Fan out the declared in-app notifications for an event through `notify()`.
 *
 * Best-effort: every `notify` call is individually try/caught and piped through
 * `logError` (tag `automation-effects`). A failed notification never throws to
 * the caller and never blocks the others — matching the contract the inline
 * `notify(...)` calls had. Events with no declared effects are a no-op.
 *
 * This does NOT call `emitEvent`. The n8n transport stays a separate, explicit
 * call at the domain action (it has its own kill-switch + sub-flag gating).
 */
export async function dispatchEffects(
  event: FurqanEvent,
  ctx: EffectContext,
): Promise<void> {
  const resolvers = EVENT_EFFECTS[event];
  if (!resolvers || resolvers.length === 0) return;

  await Promise.allSettled(
    resolvers.map(async (resolve) => {
      let effect: ResolvedEffect | null;
      try {
        effect = resolve(ctx);
      } catch (err) {
        logError("dispatchEffects: resolver threw", err, {
          tag: "automation-effects",
          event,
        });
        return;
      }
      if (!effect) return;
      try {
        await notify({
          userId: effect.userId,
          type: effect.type,
          title: effect.title,
          body: effect.body,
          entityType: effect.entityType,
          entityId: effect.entityId,
          urgent: effect.urgent,
        });
      } catch (err) {
        logError("dispatchEffects: notify failed", err, {
          tag: "automation-effects",
          event,
          recipient: effect.userId,
        });
      }
    }),
  );
}

/** Narrow an unknown context field to a non-empty id string, else null. */
function asId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ─── Follow-up: events still hand-rolling their notify fan-out ───────────────
//
// The remaining ~80 notify call sites are not yet migrated. The clear
// single-recipient ones come next; the harder ones (multi-recipient,
// recipient looked up mid-action, conditional copy) need their lookups hoisted
// into context first. Non-exhaustive backlog of obvious candidates:
//   - homework.student_ready → teacher   (src/lib/actions/homework.ts)
//   - homework.graded        → student   (src/lib/actions/homework.ts)
//   - booking.confirmed      → student   (src/lib/domains/booking/orchestrate.ts)
//   - session.ended          → student   (src/lib/domains/session/orchestrate.ts)
// Migrate one event at a time: move its inline notify(...) here, then replace
// the call site with dispatchEffects(event, ctx). Keep emitEvent(...) as-is.
