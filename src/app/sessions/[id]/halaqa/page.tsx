import type { Metadata } from "next";
import { redirect, notFound, forbidden } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getT } from "@/lib/i18n/server";
import { logError } from "@/lib/logger";
import { createMeetingToken, resolveMeetingRole } from "@/lib/sessions/token-generation";
import { HalaqaRoom } from "./halaqa-room";

export const metadata: Metadata = { title: "حلقة فرقان" };

interface SessionRow {
  id: string;
  session_mode: string;
  room_name: string;
  room_url: string;
  scheduled_at: string | null;
  expires_at: string | null;
  ended_at: string | null;
  booking_id: string | null;
  session_topic_ar: string | null;
  session_topic_en: string | null;
}

export default async function HalaqaJoinPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t, dir, lang } = await getT();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/sessions/${id}/halaqa`);

  const admin = createAdminClient();

  const { data: session } = await admin
    .from("sessions")
    .select(
      "id, session_mode, room_name, room_url, scheduled_at, expires_at, ended_at, booking_id, session_topic_ar, session_topic_en",
    )
    .eq("id", id)
    .maybeSingle<SessionRow>();
  if (!session) notFound();
  if (session.session_mode !== "halaqa") {
    // Defensive: this route is halaqa-only. Private sessions have their
    // existing join surfaces; lecture is deferred. For now, send them to
    // a sensible fallback so they don't see a broken Daily iframe.
    redirect("/student/sessions");
  }
  if (session.ended_at) {
    return (
      <main dir={dir} className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="glass-card rounded-xl p-8 text-center">
          <p className="text-lg font-semibold">{t("انتهت الحلقة", "This halaqa has ended")}</p>
          <p className="mt-2 text-sm text-muted">
            {t("شكراً لمشاركتك. يمكنك تصفح الحلقات القادمة من /student/halaqas.", "Thanks for joining. Browse upcoming halaqas at /student/halaqas.")}
          </p>
        </div>
      </main>
    );
  }

  // Authorize via the role-lookup cascade (Stage 2.5).
  const role = await resolveMeetingRole(
    admin,
    { id: session.id, booking_id: session.booking_id },
    user.id,
  );
  if (!role) forbidden();

  // Display name for the participant tile.
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle<{ full_name: string | null }>();
  const userName = profile?.full_name ?? t("ضيف", "Guest");

  // Token expiry. Prefer session.expires_at (set by createSessionRoom in
  // #70); fall back to scheduled_at + 3h for safety, then now+3h as a
  // last resort so we never issue an instantly-expired token.
  const expiresAt = session.expires_at
    ? new Date(session.expires_at)
    : session.scheduled_at
      ? new Date(new Date(session.scheduled_at).getTime() + 3 * 60 * 60 * 1000)
      : new Date(Date.now() + 3 * 60 * 60 * 1000);

  let token: string;
  try {
    token = await createMeetingToken({
      roomName: session.room_name,
      userId: user.id,
      userName,
      role,
      expiresAt,
    });
  } catch (err) {
    logError("HalaqaJoinPage: createMeetingToken failed", err, {
      tag: "halaqa.join",
      metadata: { session_id: id, user_id: user.id, role },
    });
    return (
      <main dir={dir} className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="glass-card rounded-xl border border-error/30 bg-error/10 p-8 text-center">
          <p className="text-lg font-semibold text-error">
            {t("تعذّر إنشاء بطاقة الدخول", "Unable to issue meeting token")}
          </p>
          <p className="mt-2 text-sm text-muted">
            {t(
              "يرجى المحاولة لاحقاً أو التواصل مع الدعم.",
              "Please try again later or contact support.",
            )}
          </p>
        </div>
      </main>
    );
  }

  const title = (lang === "ar" ? session.session_topic_ar : session.session_topic_en) ?? "—";

  return (
    <HalaqaRoom
      roomUrl={session.room_url}
      token={token}
      title={title}
      role={role}
    />
  );
}
