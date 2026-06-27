import "server-only";

import webpush from "web-push";
import { logWarn } from "@/lib/logger";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT ?? "mailto:support@furqan.today";

let client: typeof webpush | null = null;

if (!publicKey || !privateKey) {
  logWarn("Web push is disabled because VAPID keys are not configured", {
    tag: "push",
  });
} else {
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    client = webpush;
  } catch (error) {
    logWarn("Web push is disabled because VAPID configuration is invalid", {
      tag: "push",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const configuredWebpush = client;
