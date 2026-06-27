import { NextResponse } from "next/server";
import { z } from "zod";
import { sendPushToUser } from "@/lib/push/send";
import { safeCompareSecret } from "@/lib/security/secrets";

const sendSchema = z.object({
  userId: z.uuid(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2_000),
  // App-relative path only (leading single slash, not protocol-relative "//").
  // Keeps any URL forwarded to the service worker same-origin.
  url: z
    .string()
    .max(2_000)
    .regex(/^\/(?!\/)/, "url must be an app-relative path")
    .optional(),
  tag: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET
    ? `Bearer ${process.env.CRON_SECRET}`
    : null;
  if (!safeCompareSecret(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = sendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { userId, ...payload } = parsed.data;
  const result = await sendPushToUser(userId, payload);
  return NextResponse.json(result);
}
