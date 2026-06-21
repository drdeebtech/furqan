// Re-export barrel — all exports live in domain-specific modules, each of
// which carries its own "use server" directive. The barrel itself must NOT
// be a "use server" module: re-exporting server actions through a second
// "use server" layer makes Turbopack try to re-register them as new actions
// in this module's scope, which drops the client reference (the leaf files
// own the directive). Plain passthrough re-export preserves it.
// Existing importers of this path continue to work without changes.
export {
  updateBookingStatus,
  recreateRoom,
} from "@/lib/actions/teacher-booking";

export {
  markNoShow,
  endSession,
  extendSessionRoom,
  saveQuickNotes,
  startInstantSession,
} from "@/lib/actions/teacher-session";
