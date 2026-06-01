/**
 * Session domain — types & error classes for the session-end orchestrator.
 *
 * Per ADR-0002 / ADR-0004:
 * - Domain functions take **structured input** (no FormData), already
 *   authenticated by the route adapter.
 * - They **throw** domain-meaningful subclasses; adapters map them to
 *   user-facing Arabic messages without inspecting message strings.
 */

/** Structured input for `endSession`. The route adapter authorizes first
 *  (teacher owns the booking, or admin) and passes the acting user's id. */
export interface EndSessionInput {
  sessionId: string;
  /** The user performing the end. Used to decide notify recipients: when the
   *  actor is NOT the session's teacher (i.e. an admin force-end), the teacher
   *  is notified that their session was ended. */
  actorId: string;
  /** Optional reason (admin force-end). Surfaced in the teacher notification
   *  and the diff audit row. */
  reason?: string | null;
}

export interface EndSessionResult {
  sessionId: string;
  bookingId: string;
  /** Computed wall-clock minutes (or the booking's planned duration when the
   *  session never recorded a start). */
  actualDuration: number;
  /** True when the session was already ended (Daily webhook / double-fire);
   *  the orchestrator did no work. Adapters still report success. */
  alreadyEnded: boolean;
}

/** Pre-read returned no session row. */
export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`session ${sessionId} not found`);
    this.name = "SessionNotFoundError";
  }
}

/** Unexpected DB error during the atomic end path. */
export class SessionEndError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SessionEndError";
  }
}
