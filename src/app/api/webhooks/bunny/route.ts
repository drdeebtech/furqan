import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  bunnyStatusToVideoStatus,
  getVideo,
  verifyBunnyWebhookSignature,
  type BunnyWebhookPayload,
} from "@/lib/bunny/client";
import { logError } from "@/lib/logger";

// Bunny.net Stream webhook receiver.
//
// Configured in the Bunny dashboard at: Library → Settings → Webhook
//   URL:    https://furqan.today/api/webhooks/bunny
//   Method: POST
//   Auth:   HMAC SHA256 with BUNNY_WEBHOOK_SECRET, header `Bunny-Signature`
//   Events: Video Encoded, Video Failed
//
// Idempotency: keyed on VideoGuid. Late or duplicate deliveries simply
// re-run the status update; result is the same.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature =
    req.headers.get("bunny-signature") ?? req.headers.get("Bunny-Signature") ?? "";

  if (!signature) {
    return NextResponse.json(
      { ok: false, error: "missing signature" },
      { status: 401 },
    );
  }

  let valid = false;
  try {
    valid = verifyBunnyWebhookSignature(rawBody, signature);
  } catch (err) {
    logError("bunny webhook signature verify failed", err, { tag: "bunny-webhook" });
    return NextResponse.json(
      { ok: false, error: "signature verify failed" },
      { status: 500 },
    );
  }

  if (!valid) {
    return NextResponse.json(
      { ok: false, error: "invalid signature" },
      { status: 401 },
    );
  }

  let payload: BunnyWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as BunnyWebhookPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 },
    );
  }

  if (!payload.VideoGuid || typeof payload.Status !== "number") {
    return NextResponse.json(
      { ok: false, error: "missing VideoGuid or Status" },
      { status: 400 },
    );
  }

  const newStatus = bunnyStatusToVideoStatus(payload.Status);
  const supabase = createAdminClient();

  let durationSeconds: number | null = null;
  if (newStatus === "ready") {
    try {
      const info = await getVideo(payload.VideoGuid);
      if (info.length && info.length > 0) durationSeconds = Math.round(info.length);
    } catch (err) {
      logError("bunny webhook: getVideo failed (continuing anyway)", err, {
        tag: "bunny-webhook",
        videoId: payload.VideoGuid,
      });
    }
  }

  const updatePayload: Record<string, unknown> = { video_status: newStatus };
  if (durationSeconds !== null) updatePayload.duration_seconds = durationSeconds;

  const { data: updated, error } = await supabase
    .from("course_lessons")
    .update(updatePayload as never)
    .eq("bunny_video_id", payload.VideoGuid)
    .select("id, course_id")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json(
        { ok: true, note: "no lesson matching VideoGuid" },
        { status: 200 },
      );
    }
    logError("bunny webhook: lesson update failed", error, {
      tag: "bunny-webhook",
      videoId: payload.VideoGuid,
    });
    return NextResponse.json(
      { ok: false, error: "db update failed" },
      { status: 500 },
    );
  }

  if (newStatus === "ready" && updated?.course_id) {
    try {
      const { data: readyLessons } = await supabase
        .from("course_lessons")
        .select("duration_seconds")
        .eq("course_id", updated.course_id)
        .eq("video_status", "ready");

      if (readyLessons) {
        const totalDuration = readyLessons.reduce(
          (sum, l) => sum + (l.duration_seconds ?? 0),
          0,
        );
        await supabase
          .from("courses")
          .update({ duration_seconds_cached: totalDuration } as never)
          .eq("id", updated.course_id);
      }
    } catch (err) {
      logError("bunny webhook: aggregate recompute failed", err, {
        tag: "bunny-webhook",
        courseId: updated.course_id,
      });
    }
  }

  return NextResponse.json({ ok: true, lessonId: updated?.id, status: newStatus });
}
