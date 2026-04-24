import type { Notification } from "@/types/database";

/**
 * Derive a navigation target for a notification based on its type and the
 * free-form data payload. Returns null for informational-only notifications
 * (e.g. system announcements without a linked resource) — callers should
 * render those as a mark-read-on-click button instead of a Link.
 *
 * Used by both the full notifications list page and the topbar bell dropdown
 * so the two surfaces stay in sync.
 */
export function notificationHref(n: Notification, rolePrefix: string): string {
  const d = (n.data ?? {}) as Record<string, unknown>;
  const asId = (v: unknown): string | null =>
    typeof v === "string" && v ? v : null;

  // Fallback for every unlinked notification — the detail page shows the full
  // body and auto-marks-read, so users always get a clickable target.
  const detail = `${rolePrefix}/notifications/${n.id}`;

  switch (n.type) {
    case "booking":
      return `${rolePrefix}/bookings`;
    case "homework":
      return `${rolePrefix}/homework`;
    case "reminder": {
      const sid = asId(d.session_id);
      return sid ? `${rolePrefix}/sessions/${sid}` : `${rolePrefix}/sessions`;
    }
    case "message": {
      const cid = asId(d.conversation_id);
      return cid
        ? `${rolePrefix}/messages?c=${cid}`
        : `${rolePrefix}/messages`;
    }
    case "payment":
      return rolePrefix === "/student" ? `${rolePrefix}/packages` : detail;
    case "system":
    default:
      return detail;
  }
}
