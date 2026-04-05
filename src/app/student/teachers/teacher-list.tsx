"use client";

import { useState } from "react";
import Link from "next/link";
import { GraduationCap, Star, Users, Search } from "lucide-react";
import { SESSION_TYPE_AR, RIWAYA_AR } from "@/lib/constants";
import type { SessionType, RecitationStandard } from "@/types/database";
import type { TeacherData } from "./page";

const SPECIALTIES: { key: string; ar: string }[] = [
  { key: "all", ar: "الكل" },
  { key: "hifz", ar: "حفظ" },
  { key: "tajweed", ar: "تجويد" },
  { key: "muraja", ar: "مراجعة" },
  { key: "tilawa", ar: "تلاوة" },
  { key: "qiraat", ar: "قراءات" },
  { key: "tafsir", ar: "تفسير" },
];

export function TeacherList({ teachers }: { teachers: TeacherData[] }) {
  const [specialty, setSpecialty] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = teachers.filter((t) => {
    if (specialty !== "all" && !t.specialties.includes(specialty)) return false;
    if (searchQuery && !t.name.includes(searchQuery)) return false;
    return true;
  });

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <GraduationCap size={24} className="text-gold" />
          المعلمون
        </h1>
        <p className="mt-1 text-sm text-muted">Browse teachers and book a session</p>
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-3 rounded-xl border border-card-border bg-card p-4">
        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث بالاسم..."
            className="w-full rounded-lg border border-input-border bg-input py-2 pe-4 ps-10 text-sm text-foreground placeholder:text-muted/50 focus:border-gold focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Specialty filter */}
          <div className="flex flex-wrap gap-1.5">
            {SPECIALTIES.map((s) => (
              <button
                key={s.key}
                onClick={() => setSpecialty(s.key)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  specialty === s.key
                    ? "bg-gold font-medium text-background"
                    : "border border-card-border text-muted hover:border-gold/40"
                }`}
              >
                {s.ar}
              </button>
            ))}
          </div>

        </div>

        <p className="text-xs text-muted">{filtered.length} معلم</p>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <Users size={32} className="mx-auto mb-3 text-muted" />
          <p className="text-muted">لا يوجد معلمون مطابقون</p>
          <button onClick={() => { setSpecialty("all"); setSearchQuery(""); }} className="mt-3 text-sm text-gold hover:text-gold-light">
            إعادة ضبط الفلاتر
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((teacher) => {
            const bio = teacher.bio && teacher.bio.length > 100 ? teacher.bio.slice(0, 100) + "…" : teacher.bio;

            return (
              <div key={teacher.teacher_id} className="rounded-xl border border-card-border bg-card p-5">
                <div className="mb-3 flex items-start gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-card-border bg-surface text-xl font-bold">
                    {teacher.name.trim().charAt(0) || "؟"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold">{teacher.name}</p>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Star key={i} size={14} className={i <= Math.round(Number(teacher.rating_avg)) ? "fill-gold text-gold" : "text-card-border"} />
                      ))}
                      <span className="mr-1.5 text-xs text-muted">{Number(teacher.rating_avg) > 0 ? Number(teacher.rating_avg).toFixed(1) : "—"}</span>
                    </div>
                  </div>
                </div>

                {bio && <p className="mb-3 text-sm leading-relaxed text-muted">{bio}</p>}

                <p className="mb-3 text-xs text-muted">{teacher.total_sessions} جلسة مكتملة</p>

                {teacher.specialties.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {teacher.specialties.map((s) => (
                      <span key={s} className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs text-gold">
                        {SESSION_TYPE_AR[s as SessionType] ?? s}
                      </span>
                    ))}
                  </div>
                )}

                {teacher.recitation_standards.length > 0 && (
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {[...new Set(teacher.recitation_standards)].map((r) => (
                      <span key={r} className="rounded-full border border-card-border px-2 py-0.5 text-xs text-muted">
                        {RIWAYA_AR[r as RecitationStandard] ?? r}
                      </span>
                    ))}
                  </div>
                )}

                <Link
                  href={`/student/bookings/new?teacher=${teacher.teacher_id}`}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-gold py-2.5 font-semibold text-white transition-colors hover:bg-gold-hover"
                >
                  احجز جلسة
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
