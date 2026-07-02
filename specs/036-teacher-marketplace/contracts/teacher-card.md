# Contract: TeacherCard (UI type)

The shape that `src/lib/supabase/teacher-search.ts` returns and that `TeachersContent` renders.

## TeacherCard

```typescript
interface TeacherCard {
  id: string;           // teacher_profiles.teacher_id = profiles.id
  name: string;         // profiles.full_name (English)
  nameAr: string | null;// profiles.full_name_ar (Arabic)
  avatarUrl: string;    // profiles.avatar_url — guaranteed non-null (SQL gate)
  bio: string | null;   // teacher_profiles.bio (Arabic)
  bioEn: string | null; // teacher_profiles.bio_en (English)
  languages: string[];  // teacher_profiles.languages (codes: "ar", "en", "ur"…)
  specialties: string[];// teacher_profiles.specialties (keys from teacher_specialties)
  hourlyRate: number;   // teacher_profiles.hourly_rate (USD per session)
  ratingAvg: number;    // teacher_profiles.rating_avg
  ratingCount: number;  // count from reviews table; show rating only when ≥ 3
  totalSessions: number;// teacher_profiles.total_sessions
  gender: string | null;// teacher_profiles.gender ("male" | "female" | null)
}
```

## TeacherSearchResult (API response body)

```typescript
interface TeacherSearchResult {
  teachers: TeacherCard[];
  total: number;   // total matching rows (for pagination)
  page: number;    // current page (1-indexed)
  limit: number;   // items per page
}
```

## SearchParams (URL state)

```typescript
interface SearchParams {
  q?: string;         // free-text query
  language?: string;  // language code
  gender?: 'male' | 'female';
  specialty?: string; // specialty key
  price_min?: number;
  price_max?: number;
  page?: number;      // default 1
}
```

## Compatibility with existing Teacher type

The existing `content.tsx` uses a `Teacher` interface locally. `TeacherCard` is a superset: all existing fields are present with compatible types. The migration path is to replace the local `Teacher` type with `TeacherCard` from `src/lib/supabase/teacher-search.ts`.
