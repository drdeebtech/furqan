"use server";

// Re-export barrel — all exports live in domain-specific modules.
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
