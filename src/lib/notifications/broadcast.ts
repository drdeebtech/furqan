import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/dispatcher";
import { logError } from "@/lib/logger";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

/**
 * Off-request-path broadcast delivery (audit H7).
 *
 * The admin action enqueues a `notification_broadcasts` row and calls this from
 * Next.js `after()` for an immediate start; the dual-auth
 * /api/cron/process-broadcasts route calls it as a reliable drainer for any
 * remainder a large broadcast couldn't finish within one function budget.
 *
 * Recipients are resolved by an id cursor (`cursor_after`) and notified in
 * bounded-concurrency batches, so memory + concurrency stay flat regardless of
 * audience size. Progress (cursor, counts) is persisted after every page, so a
 * timed-out run resumes exactly where it stopped.
 */

const PAGE = 500;
const CONCURRENCY = 25;

type Target = "all" | "student" | "teacher";

interface BroadcastRow {
  id: string;
  target: Target;
  title: string;
  body: string | null;
  status: string;
  cursor_after: string | null;
  recipients_sent: number;
  recipients_failed: number;
}

/**
 * Process (or resume) one broadcast until the audience is exhausted or the time
 * budget runs out. Returns whether the broadcast is now complete.
 */
export async function processBroadcast(
  broadcastId: string,
  budgetMs = 20_000,
): Promise<{ done: boolean; sent: number; failed: number }> {
  const deadline = Date.now() + budgetMs;
  const admin = createAdminClient();

  const { data: b, error } = await admin
    .from("notification_broadcasts")
    .select("id, target, title, body, status, cursor_after, recipients_sent, recipients_failed")
    .eq("id", broadcastId)
    .single<BroadcastRow>();
  if (error || !b) {
    logError("processBroadcast: broadcast not found", error, { tag: "broadcast", broadcastId });
    return { done: false, sent: 0, failed: 0 };
  }
  if (b.status === "sent" || b.status === "failed") {
    return { done: true, sent: b.recipients_sent, failed: b.recipients_failed };
  }

  await admin.from("notification_broadcasts")
    .update({ status: "processing" } satisfies TableUpdate<"notification_broadcasts">)
    .eq("id", broadcastId);

  let cursor = b.cursor_after;
  let sent = b.recipients_sent;
  let failed = b.recipients_failed;
  let done = false;

  while (Date.now() < deadline) {
    let q = admin.from("profiles").select("id").eq("is_active", true).order("id", { ascending: true }).limit(PAGE);
    if (b.target === "student" || b.target === "teacher") q = q.eq("role", b.target);
    if (cursor) q = q.gt("id", cursor);

    const { data: users, error: usersErr } = await q.returns<{ id: string }[]>();
    if (usersErr) {
      logError("processBroadcast: recipient page failed", usersErr, { tag: "broadcast", broadcastId });
      break; // leave status='processing' so the drainer retries
    }
    if (!users || users.length === 0) { done = true; break; }

    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const batch = users.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(u => notify({ userId: u.id, type: "system", title: b.title, body: b.body ?? undefined })),
      );
      for (const r of results) {
        if (r.status === "fulfilled") sent += 1;
        else { failed += 1; }
      }
    }

    cursor = users[users.length - 1].id;
    await admin.from("notification_broadcasts")
      .update({ cursor_after: cursor, recipients_sent: sent, recipients_failed: failed } satisfies TableUpdate<"notification_broadcasts">)
      .eq("id", broadcastId);

    if (users.length < PAGE) { done = true; break; }
  }

  if (done) {
    await admin.from("notification_broadcasts")
      .update({ status: "sent", recipients_sent: sent, recipients_failed: failed, processed_at: new Date().toISOString() } satisfies TableUpdate<"notification_broadcasts">)
      .eq("id", broadcastId);
  }

  return { done, sent, failed };
}
