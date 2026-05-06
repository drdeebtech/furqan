"use client";

import { useLang } from "@/lib/i18n/context";

interface Props {
  roomUrl: string;
  token: string;
  title: string;
  role: "teacher" | "student" | "observer";
}

/**
 * Stage 6 minimum-viable halaqa video page.
 *
 * Embeds Daily's prebuilt UI via iframe with `?t=<token>`. Daily handles
 * the participant grid, mic/camera controls, recording (if enabled in
 * createSessionRoom from #70), and join/leave events.
 *
 * What this MVP does NOT have (deferred to future Stage 6 expansion):
 *
 *   - Custom React grid layout via @daily-co/daily-js + daily-react
 *     (would replace iframe but adds significant bundle size)
 *   - Teacher controls beyond what Daily's prebuilt UI provides
 *     (mute-all, current-reciter spotlight, hand-raise queue)
 *   - Custom Quranic-context panel (surah/ayah reference)
 *   - Attendance tracking via Daily's "participant joined" events
 *     (would update session_participants.joined_at / left_at +
 *     attendance_status)
 *
 * The iframe approach is intentional for v1 — ship the working video
 * call, then iterate the host UX in dedicated PRs once the route is in
 * production and we have real teacher feedback.
 */
export function HalaqaRoom({ roomUrl, token, title, role }: Props) {
  const { t, dir } = useLang();

  // Daily's `?t=` URL param accepts a meeting token; the prebuilt UI
  // joins automatically. `userName` is encoded into the token itself
  // (set in createMeetingToken), so no extra param needed.
  const embedUrl = `${roomUrl}?t=${encodeURIComponent(token)}`;

  return (
    <main dir={dir} className="flex h-screen flex-col bg-black">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{title}</p>
          <p className="text-xs text-white/60">
            {role === "teacher"
              ? t("أنت المعلم", "You're the teacher")
              : role === "observer"
                ? t("أنت مراقب — مخفي عن المشاركين", "You're observing — hidden from participants")
                : t("أنت في الحلقة", "You're in the halaqa")}
          </p>
        </div>
      </header>

      <div className="flex-1">
        {/* Daily's prebuilt UI — handles tiles, mic/cam, knock-to-join,
            recording controls (when allow_recording was set on the
            session), participant list, leave button. */}
        <iframe
          src={embedUrl}
          allow="camera; microphone; fullscreen; speaker; display-capture"
          className="h-full w-full border-0"
          title={title}
        />
      </div>
    </main>
  );
}
