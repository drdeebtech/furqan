import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BunnyApiError,
  bunnyStatusToVideoStatus,
  getVideo,
  verifyBunnyWebhookSignature,
  type BunnyWebhookPayload,
} from "@/lib/bunny/client";
import { logError, logWarn } from "@/lib/logger";
import type { TableUpdate } from "@/lib/supabase/typed-helpers";

// One-shot helper: write the outcome of a webhook delivery to automation_logs
// so "did Bunny call us, and what happened" is answerable without log-diving.
// Best-effort — never fails the request.
async function logBunnyWebhook(
  supabase: ReturnType<typeof createAdminClient>,
  args: {
    status: "succeeded" | "failed";
    eventName: string;
    lessonId?: string | null;
    payload: unknown;
    result?: unknown;
    error?: string;
    startedAt: string;
  },
) {
  await supabase
    .from("automation_logs")
    .insert({
      workflow_name: "bunny.webhook",
      event_name: args.eventName,
      entity_type: args.lessonId ? "course_lesson" : null,
      entity_id: args.lessonId ?? null,
      status: args.status,
      payload_json: args.payload as never,
      result_json: (args.result ?? null) as never,
      error_message: args.error ?? null,
      started_at: args.startedAt,
      finished_at: new Date().toISOString(),
    } as never)
    .then(({ error }) => {
      if (error) {
        logError("bunny webhook automation_logs insert failed", error, {
          tag: "bunny-webhook",
        });
      }
    });
}

// Bunny.net Stream webhook receiver.
//
// Configured in the Bunny dashboard at: Library → Settings → Webhook
//   URL:    https://www.furqan.today/api/webhooks/bunny
//   Method: POST
//   Auth:   HMAC SHA256 with BUNNY_WEBHOOK_SECRET, header `Bunny-Signature`
//   Events: Video Encoded, Video Failed
//
// Idempotency: keyed on VideoGuid. Late or duplicate deliveries simply
// re-run the status update; result is the same.

export async function POST(req: Request): Promise<NextResponse> {
  const startedAt = new Date().toISOString();
  const rawBody = await req.text();
  // Per Bunny stream webhook docs (signature version v1):
  //   X-BunnyStream-Signature-Version   v1
  //   X-BunnyStream-Signature-Algorithm hmac-sha256
  //   X-BunnyStream-Signature           lowercase hex HMAC-SHA256
  const signature = req.headers.get("x-bunnystream-signature") ?? "";
  const signatureVersion =
    req.headers.get("x-bunnystream-signature-version") ?? "";
  const signatureAlgorithm =
    req.headers.get("x-bunnystream-signature-algorithm") ?? "";
  // admin: webhook — no user session; Bunny video lifecycle (issue #523)
  const supabase = createAdminClient();

  if (!signature) {
    // no security-alert here: unauthenticated path, flood vector (see PR #686 review)
    await logBunnyWebhook(supabase, {
      status: "failed",
      eventName: "bunny.webhook.rejected",
      payload: { reason: "missing-signature" },
      error: "missing signature",
      startedAt,
    });
    return NextResponse.json(
      { ok: false, error: "missing signature" },
      { status: 401 },
    );
  }

  let valid = false;
  try {
    valid = verifyBunnyWebhookSignature(
      rawBody,
      signature,
      signatureVersion,
      signatureAlgorithm,
    );
  } catch (err) {
    logError("bunny webhook signature verify failed", err, { tag: "bunny-webhook" });
    await logBunnyWebhook(supabase, {
      status: "failed",
      eventName: "bunny.webhook.error",
      payload: { reason: "verify-threw" },
      error: (err as Error).message,
      startedAt,
    });
    return NextResponse.json(
      { ok: false, error: "signature verify failed" },
      { status: 500 },
    );
  }

  if (!valid) {
    // no security-alert here: unauthenticated path, flood vector (see PR #686 review)
    await logBunnyWebhook(supabase, {
      status: "failed",
      eventName: "bunny.webhook.rejected",
      payload: { reason: "invalid-signature" },
      error: "invalid signature",
      startedAt,
    });
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

  // Non-status events (CaptionsGenerated, TitleOrDescriptionGenerated)
  // return null — log them and short-circuit to avoid bouncing a ready
  // video back to processing.
  if (newStatus === null) {
    await logBunnyWebhook(supabase, {
      status: "succeeded",
      eventName: `bunny.video.event.${payload.Status}`,
      payload: { VideoGuid: payload.VideoGuid, Status: payload.Status },
      result: { ignored: true, reason: "non-status event" },
      startedAt,
    });
    return NextResponse.json({ ok: true, ignored: true, status: payload.Status });
  }

  let durationSeconds: number | null = null;
  if (newStatus === "ready") {
    try {
      const info = await getVideo(payload.VideoGuid);
      if (info.length && info.length > 0) durationSeconds = Math.round(info.length);
    } catch (err) {
      // 404 here is expected and recoverable: the video was deleted between
      // Bunny firing the webhook and us asking back, OR a smoke-test webhook
      // is using a fake VideoGuid. We have no duration to record but the
      // status update still goes through — log to Sentry → Logs (visible,
      // not paged) instead of Sentry → Issues. Other statuses are real bugs
      // worth surfacing as issues. Fixes JAVASCRIPT-NEXTJS-E4-H.
      if (err instanceof BunnyApiError && err.status === 404) {
        logWarn("bunny webhook: getVideo 404 — continuing without duration", {
          tag: "bunny-webhook",
          videoId: payload.VideoGuid,
        });
      } else {
        logError("bunny webhook: getVideo failed (continuing anyway)", err, {
          tag: "bunny-webhook",
          videoId: payload.VideoGuid,
        });
      }
    }
  }

  const updatePayload: TableUpdate<"course_lessons"> = { video_status: newStatus };
  if (durationSeconds !== null) updatePayload.duration_seconds = durationSeconds;

  const { data: updated, error } = await supabase
    .from("course_lessons")
    .update(updatePayload)
    .eq("bunny_video_id", payload.VideoGuid)
    .select("id, course_id")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      await logBunnyWebhook(supabase, {
        status: "succeeded",
        eventName: `bunny.video.${newStatus}`,
        payload: { VideoGuid: payload.VideoGuid, Status: payload.Status },
        result: { matched: false, note: "no lesson matching VideoGuid" },
        startedAt,
      });
      return NextResponse.json(
        { ok: true, note: "no lesson matching VideoGuid" },
        { status: 200 },
      );
    }
    logError("bunny webhook: lesson update failed", error, {
      tag: "bunny-webhook",
      videoId: payload.VideoGuid,
    });
    await logBunnyWebhook(supabase, {
      status: "failed",
      eventName: `bunny.video.${newStatus}`,
      payload: { VideoGuid: payload.VideoGuid, Status: payload.Status },
      error: error.message,
      startedAt,
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
          .update({ duration_seconds_cached: totalDuration } satisfies TableUpdate<"courses">)
          .eq("id", updated.course_id);
      }
    } catch (err) {
      logError("bunny webhook: aggregate recompute failed", err, {
        tag: "bunny-webhook",
        courseId: updated.course_id,
      });
    }
  }

  await logBunnyWebhook(supabase, {
    status: "succeeded",
    eventName: `bunny.video.${newStatus}`,
    lessonId: updated?.id ?? null,
    payload: { VideoGuid: payload.VideoGuid, Status: payload.Status },
    result: { lessonId: updated?.id, newStatus, durationSeconds },
    startedAt,
  });

  return NextResponse.json({ ok: true, lessonId: updated?.id, status: newStatus });
}
