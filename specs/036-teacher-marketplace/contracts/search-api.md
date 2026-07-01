# Contract: GET /api/teachers/search

## Overview
Public, unauthenticated endpoint. Returns a paginated list of published teacher cards matching the given search query and filters.

## Request

```
GET /api/teachers/search?q=tajweed&language=ar&gender=female&specialty=hifz&price_min=10&price_max=40&page=1&limit=12
```

### Query Parameters

| Param | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `q` | string | No | max 200 chars | Free-text keyword (Arabic or English) |
| `language` | string | No | max 50 chars | Language code, e.g. `ar`, `en`, `ur` |
| `gender` | `male` \| `female` | No | enum | Teacher gender |
| `specialty` | string | No | max 100 chars | Specialty key from `teacher_specialties` table |
| `price_min` | number | No | ≥ 0 | Minimum hourly rate (inclusive) |
| `price_max` | number | No | ≥ 0 | Maximum hourly rate (inclusive) |
| `page` | integer | No | ≥ 1, default 1 | Page number |
| `limit` | integer | No | 1–50, default 12 | Results per page |

All params are validated with zod. Invalid params return 400.

## Response: 200 OK

```json
{
  "teachers": [
    {
      "id": "uuid",
      "name": "Sheikh Ahmad",
      "nameAr": "الشيخ أحمد",
      "avatarUrl": "https://cdn.bunny.net/...",
      "bio": "حافظ للقرآن الكريم...",
      "bioEn": "Certified Quran teacher...",
      "languages": ["ar", "en"],
      "specialties": ["hifz", "tajweed"],
      "hourlyRate": 25,
      "ratingAvg": 4.8,
      "ratingCount": 12,
      "totalSessions": 156,
      "gender": "male"
    }
  ],
  "total": 47,
  "page": 1,
  "limit": 12
}
```

## Response: 400 Bad Request

```json
{ "error": "Invalid search parameters", "details": { "gender": ["Invalid enum value"] } }
```

## Response: 500 Internal Server Error

```json
{ "error": "Search temporarily unavailable" }
```

The UI handles 500 by showing a visible error state (not a silent empty list). The existing teacher listing (from the Server Component initial render) remains visible as a fallback.

## Authentication
None required. The route is fully public. The underlying Postgres function enforces all published-teacher gates in SQL.

## Caching
Response headers: `Cache-Control: public, max-age=30, stale-while-revalidate=300`
A 30-second CDN cache balances freshness with load at scale. Admin profile updates call `revalidateTag('teachers-public')` which also invalidates this route.

## Security
- zod validates all query params before the DB call
- Postgres function is `SECURITY DEFINER` with `REVOKE EXECUTE FROM anon, authenticated` — only callable via service_role (the server-side `createAdminClient()`)
- No user identity is read or required; no RLS bypass is visible to the client
