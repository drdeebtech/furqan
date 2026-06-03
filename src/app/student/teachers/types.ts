import type { GenderType } from "@/types/database";

export interface TeacherData {
  teacher_id: string;
  name: string;
  nameAr: string | null;
  bio: string | null;
  bio_en: string | null;
  specialties: string[];
  recitation_standards: string[];
  hourly_rate: number;
  rating_avg: number;
  total_sessions: number;
  gender: GenderType | null;
}
