import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "المعلمون | فرقان" };
import Link from "next/link";
import { GraduationCap, Star, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SESSION_TYPE_AR, RIWAYA_AR } from "@/lib/constants";
import type { SessionType, GenderType, RecitationStandard } from "@/types/database";

interface TeacherRow {
  teacher_id: string;
  bio: string | null;
  specialties: string[];
  recitation_standards: string[];
  hourly_rate: number;
  rating_avg: number;
  total_sessions: number;
  gender: GenderType | null;
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={14}
          className={
            i <= Math.round(rating)
              ? "fill-gold text-gold"
              : "text-card-border"
          }
        />
      ))}
      <span className="mr-1.5 text-xs text-muted">
        {rating > 0 ? rating.toFixed(1) : "—"}
      </span>
    </div>
  );
}

function Initials({ name }: { name: string }) {
  const letter = name.trim().charAt(0) || "؟";
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-card-border bg-card text-xl font-bold text-foreground">
      {letter}
    </div>
  );
}

export default async function TeachersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: teachers } = await supabase
    .from("teacher_profiles")
    .select(
      "teacher_id, bio, specialties, recitation_standards, hourly_rate, rating_avg, total_sessions, gender",
    )
    .eq("is_archived", false)
    .eq("is_accepting", true)
    .order("rating_avg", { ascending: false })
    .returns<TeacherRow[]>();

  const teacherList = teachers ?? [];

  // Fetch names from profiles
  let nameMap: Record<string, string> = {};
  if (teacherList.length > 0) {
    const ids = teacherList.map((t) => t.teacher_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
      .returns<{ id: string; full_name: string | null }[]>();

    if (profiles) {
      nameMap = Object.fromEntries(
        profiles.map((p) => [p.id, p.full_name ?? "معلم"]),
      );
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">
          <GraduationCap size={24} className="ml-2 inline text-gold" />
          المعلمون
        </h1>
        <p className="mt-1 text-sm text-muted">Browse teachers and book a session</p>
      </div>

      {teacherList.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Users size={40} className="mx-auto mb-4 text-muted" />
          <p className="text-lg text-muted">لا يوجد معلمون حالياً</p>
          <p className="mt-1 text-sm text-muted">No teachers available yet</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teacherList.map((teacher) => {
            const name = nameMap[teacher.teacher_id] ?? "معلم";
            const bio =
              teacher.bio && teacher.bio.length > 100
                ? teacher.bio.slice(0, 100) + "…"
                : teacher.bio;

            return (
              <div
                key={teacher.teacher_id}
                className="rounded-xl border border-card-border bg-card p-5"
              >
                {/* Header: avatar + name + rate */}
                <div className="mb-3 flex items-start gap-3">
                  <Initials name={name} />
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold">{name}</p>
                    <Stars rating={Number(teacher.rating_avg)} />
                  </div>
                  <div className="text-left">
                    <span className="text-xl font-bold text-gold">
                      ${teacher.hourly_rate}
                    </span>
                    <span className="text-xs text-muted">/ساعة</span>
                  </div>
                </div>

                {/* Bio */}
                {bio && (
                  <p className="mb-3 text-sm leading-relaxed text-muted">
                    {bio}
                  </p>
                )}

                {/* Sessions count */}
                <p className="mb-3 text-xs text-muted">
                  {teacher.total_sessions} جلسة مكتملة
                  <span className="mx-1">·</span>
                  {teacher.total_sessions} completed sessions
                </p>

                {/* Specialties */}
                {teacher.specialties.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {teacher.specialties.map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs text-gold"
                      >
                        {SESSION_TYPE_AR[s as SessionType] ?? s}
                      </span>
                    ))}
                  </div>
                )}

                {/* Recitation standards */}
                {teacher.recitation_standards.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {teacher.recitation_standards.map((r) => (
                      <span
                        key={r}
                        className="rounded-full border border-card-border px-2 py-0.5 text-xs text-muted"
                      >
                        {RIWAYA_AR[r as RecitationStandard] ?? r}
                      </span>
                    ))}
                  </div>
                )}

                {/* Book button */}
                <Link
                  href={`/student/bookings/new?teacher=${teacher.teacher_id}`}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gold py-2.5 font-semibold text-black transition-colors hover:bg-gold-hover"
                >
                  احجز جلسة
                  <span className="text-sm opacity-70">Book Session</span>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
