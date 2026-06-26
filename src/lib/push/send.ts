import "server-only";

import type { PushSubscription } from "web-push";
import { logError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredWebpush } from "./vapid";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type PushSendResult = {
  sent: number;
  failed: number;
};

type PushError = Error & { statusCode?: number };

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, failed: 0 };

  try {
    // Admin read is required to fan out to another user's RLS-protected subscriptions.
    const admin = createAdminClient();
    const { data: subscriptions, error } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, keys_p256dh, keys_auth")
      .eq("user_id", userId);

    if (error) {
      logError("push: subscription lookup failed", error, { tag: "push", userId });
      return result;
    }

    const client = configuredWebpush;
    if (!client) {
      return { sent: 0, failed: subscriptions.length };
    }

    await Promise.all(
      subscriptions.map(async (subscription) => {
        const pushSubscription: PushSubscription = {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys_p256dh,
            auth: subscription.keys_auth,
          },
        };

        try {
          await client.sendNotification(
            pushSubscription,
            JSON.stringify(payload),
          );
          result.sent += 1;
        } catch (error) {
          result.failed += 1;
          const statusCode = (error as PushError).statusCode;

          if (statusCode === 404 || statusCode === 410) {
            // Admin delete is required to remove a dead endpoint regardless of owner RLS.
            const { error: deleteError } = await admin
              .from("push_subscriptions")
              .delete()
              .eq("id", subscription.id);
            if (deleteError) {
              logError("push: dead subscription cleanup failed", deleteError, {
                tag: "push",
                userId,
                subscriptionId: subscription.id,
              });
            }
            return;
          }

          logError("push: notification delivery failed", error, {
            tag: "push",
            userId,
            subscriptionId: subscription.id,
          });
        }
      }),
    );
  } catch (error) {
    logError("push: unexpected send failure", error, { tag: "push", userId });
  }

  return result;
}
