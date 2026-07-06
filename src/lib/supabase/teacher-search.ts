import { z } from "zod";
import { createAdminClient } from "./admin";
import { callRpc } from "./rpc";

export interface TeacherCard {
  id: string;
  name: string;
  nameAr: string | null;
  avatarUrl: string | null;
  bio: string | null;
  bioEn: string | null;
  languages: string[];
  specialties: string[];
  recitationStandards: string[];
  hourlyRate: number;
  ratingAvg: number;
  ratingCount: number;
  totalSessions: number;
  gender: string | null;
}

export interface TeacherSearchResult {
  teachers: TeacherCard[];
  total: number;
  page: number;
  limit: number;
}

export const TeacherSearchParamsSchema = z.object({
  q:         z.string().max(200).optional(),
  language:  z.string().max(50).optional(),
  gender:    z.enum(["male", "female"]).optional(),
  specialty: z.string().max(100).optional(),
  price_min: z.coerce.number().nonnegative().optional(),
  price_max: z.coerce.number().nonnegative().optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(50).default(12),
}).refine(
  (v) => v.price_min === undefined || v.price_max === undefined || v.price_min <= v.price_max,
  { message: "price_min must be less than or equal to price_max", path: ["price_min"] },
);
export type TeacherSearchParams = z.infer<typeof TeacherSearchParamsSchema>;

export async function searchTeachers(
  params: TeacherSearchParams,
): Promise<TeacherSearchResult> {
  const supabase = createAdminClient();
  const { data, error } = await callRpc(supabase, "search_public_teachers", {
    p_query:         params.q         ?? null,
    p_language:      params.language  ?? null,
    p_gender:        params.gender    ?? null,
    p_specialty:     params.specialty ?? null,
    p_price_min:     params.price_min ?? null,
    p_price_max:     params.price_max ?? null,
    p_page:          params.page,
    p_limit:         params.limit,
  });

  if (error) throw error;

  const rows = data ?? [];
  const total = rows[0]?.total_count ?? 0;

  return {
    teachers: rows.map(rowToTeacherCard),
    total: Number(total),
    page: params.page,
    limit: params.limit,
  };
}

// Shared row → TeacherCard projection. Both search_public_teachers and
// get_public_teacher return the same column set, so the mapping lives here.
function rowToTeacherCard(r: {
  id: string;
  full_name: string | null;
  full_name_ar: string | null;
  avatar_url: string | null;
  bio: string | null;
  bio_en: string | null;
  languages: string[];
  specialties: string[];
  recitation_standards: string[];
  hourly_rate: number;
  rating_avg: number;
  rating_count: number;
  total_sessions: number;
  gender: string | null;
}): TeacherCard {
  return {
    id: r.id,
    name: r.full_name ?? "—",
    nameAr: r.full_name_ar,
    avatarUrl: r.avatar_url,
    bio: r.bio,
    bioEn: r.bio_en,
    languages: r.languages ?? [],
    specialties: r.specialties ?? [],
    recitationStandards: r.recitation_standards ?? [],
    hourlyRate: Number(r.hourly_rate),
    ratingAvg: Number(r.rating_avg),
    ratingCount: Number(r.rating_count),
    totalSessions: Number(r.total_sessions),
    gender: r.gender,
  };
}

export async function getPublicTeacher(
  id: string,
): Promise<TeacherCard | null> {
  // p_id is a Postgres `uuid`; a non-UUID slug would raise 22P02 at the DB.
  // Treat a malformed id as "not found" so the route renders notFound() (404)
  // instead of surfacing a DB error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  const supabase = createAdminClient();
  const { data, error } = await callRpc(supabase, "get_public_teacher", {
    p_id: id,
  });

  if (error) throw error;

  const rows = data ?? [];
  const r = rows[0];
  if (!r) return null;

  return rowToTeacherCard(r);
}
