# Quickstart: Teacher Marketplace (Spec 036)

## Test the search API locally

1. Start the local stack: `supabase start` + `npm run dev`
2. Apply the new migration: `supabase db reset` + `bash scripts/dev-local-db-bootstrap.sh`
3. Seed a few teacher profiles (or use existing local seed data)
4. Call the API:

```bash
# Default listing (no query)
curl "http://localhost:3000/api/teachers/search"

# Keyword search
curl "http://localhost:3000/api/teachers/search?q=tajweed"

# Arabic keyword (URL-encoded)
curl "http://localhost:3000/api/teachers/search?q=%D8%AA%D8%AC%D9%88%D9%8A%D8%AF"

# Filter by gender + specialty
curl "http://localhost:3000/api/teachers/search?gender=female&specialty=hifz"

# Price range + page 2
curl "http://localhost:3000/api/teachers/search?price_min=10&price_max=30&page=2"
```

## Test the search UI

1. Open `http://localhost:3000/teachers`
2. Type "tajweed" — results should update within 1 second
3. Select a filter — URL should update and results should narrow
4. Copy the URL — open in a new tab — same filters should apply
5. Press browser Back — previous filter state restored
6. On mobile width (375px): tap "Filters" — drawer should slide up

## Test error states

1. Invalid param: `curl "http://localhost:3000/api/teachers/search?gender=unknown"` → 400
2. Empty results: search for "xyz_no_match_xxxxx" → friendly empty state visible

## Integration test for the search RPC

After applying the migration, connect to the local DB and test the function directly:

```sql
-- Basic search
SELECT id, full_name, total_sessions FROM search_public_teachers('tajweed');

-- Arabic query (diacritics-insensitive)
SELECT id, full_name FROM search_public_teachers('تجويد');

-- Filtered
SELECT id, full_name, hourly_rate
FROM search_public_teachers(
  p_query => NULL,
  p_gender => 'female',
  p_price_max => 25
);
```
