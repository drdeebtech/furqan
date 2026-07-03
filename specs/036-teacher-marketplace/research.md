# Research: Teacher Searchable Marketplace (Spec 036)

## R-001: Postgres Full-Text Search for Arabic + English

**Decision**: `to_tsvector('simple', coalesce(bio, '') || ' ' || coalesce(bio_en, ''))` for the generated tsvector column. `tsquery` via `websearch_to_tsquery('simple', query)` in the RPC.

**Rationale**: The `simple` text search configuration in PostgreSQL:
- Tokenises text by whitespace and punctuation
- Lowercases all tokens
- Does NOT apply language-specific stemming

This is correct for a mixed Arabic/English search: Arabic words are not stemmed (stemming Arabic requires a language pack not bundled in Supabase's managed Postgres), and lowercase normalisation is sufficient for English. For diacritics-insensitive Arabic (`حفظ` matching `حِفْظ`), the `unaccent` extension strips combining characters — applied via `unaccent(query)` in the RPC before building the tsquery.

`websearch_to_tsquery` parses natural-language input (spaces = AND, quoted phrases = phrase match) which is safer than `to_tsquery` (which throws on invalid operator syntax from user input).

**GIN index**: `CREATE INDEX CONCURRENTLY teacher_profiles_search_vector_gin ON teacher_profiles USING gin(search_vector)`. `CONCURRENTLY` means the migration does not lock the table. At 50k rows a GIN index is O(n log n) to build and O(log n) to query.

**Alternatives considered**:
- `pg_trgm` GIN index: trigram similarity works well for fuzzy autocomplete but poor recall on Arabic short words and stems (Arabic words change prefix not just suffix). Rejected.
- `arabic` text search config: not available in Supabase managed Postgres without a custom dictionary. Rejected.
- External search service (Typesense, Algolia, Meilisearch): new vendor, new secret, new infra, monthly cost. Spec explicitly says Postgres only. Rejected.

## R-002: Cross-Table Search Strategy

**Decision**: Postgres RPC (`search_public_teachers`) that JOINs `teacher_profiles` + `profiles` in a single query. Name search uses `unaccent(LOWER(p.full_name)) ILIKE unaccent(LOWER('%' || query || '%'))` (functional index `CREATE INDEX ON profiles (unaccent(LOWER(full_name)))`).

**Rationale**: Splitting the search into two Supabase `.from()` calls would require:
1. Search `teacher_profiles` by tsvector → get IDs
2. Filter `profiles` by name → get IDs
3. UNION the IDs
4. Fetch all fields for the union

That's 3 round-trips minimum and makes ranking across both match types impossible. An RPC does it in one SQL statement with `ts_rank` for tsvector matches and an ILIKE for name matches, combined via `CASE WHEN query IS NULL THEN 0 ELSE ts_rank(...) END + CASE WHEN name ILIKE ... THEN 1.0 ELSE 0 END` as the relevance score.

## R-003: URL State in Next.js App Router

**Decision**: `useSearchParams()` to read, `useRouter().replace()` to write, `{ scroll: false }` on every filter update.

**Rationale**: The App Router's `useSearchParams` hook provides the current URL search params as a read-only `URLSearchParams` object. Mutating filter state calls `router.replace(newUrl, { scroll: false })` which updates the URL without a full navigation and without adding a browser history entry per keystroke. The Server Component (`page.tsx`) can then pick up the params on the next render cycle. The 300ms debounce on the search text input prevents excessive `replace` calls.

**Existing pattern**: `src/app/student/dashboard/page.tsx` already uses `searchParams` prop for tab state. Same approach.

## R-004: Debounce Without a Library

**Decision**: A 4-line `useDebounce` hook inline in `src/components/public/teacher-search-input.tsx`.

```ts
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
```

**Rationale**: The project has no debounce utility and no lodash. This 4-line hook covers the use case; no library needed (YAGNI).

## R-005: Mobile Filter Drawer

**Decision**: CSS-only drawer using Tailwind `translate-y` + `fixed inset-0` overlay, controlled by a boolean state. No external component library.

**Rationale**: The project uses Tailwind. The existing codebase does not use Radix Dialog or Headless UI for drawers (checked `grep -r "useDialog\|Sheet\|Drawer" src/ --include="*.tsx"`). A CSS-transform slide-up panel is 20 lines and zero dependencies. Matches the ponytail principle: no new dependency for a 20-line solution.

## R-006: Specialty Array Filtering in Postgres

**Decision**: `teacher_profiles.specialties @> ARRAY[specialty_filter]::text[]` — Postgres array containment operator.

**Rationale**: `teacher_profiles.specialties` is a `text[]` column (confirmed from `page.tsx` query). The `@>` containment operator checks if the column array contains all elements of the right-hand array. For a single specialty filter, `@> ARRAY['hifz']` is correct and can be indexed with a GIN index on the `specialties` column (already may exist; if not, adding it is a one-liner in the migration). Language filter uses the same `languages @> ARRAY[lang_filter]`.
