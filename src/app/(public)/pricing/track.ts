/**
 * The one real product decision on /pricing: shared teacher time, or private.
 *
 * Lives in its own module rather than in page.tsx or content.tsx because both
 * need it and neither can import the other — page.tsx pulls in `server-only`
 * (so nothing client-side or test-side may import it) and content.tsx is a
 * "use client" module. A pure validator for untrusted URL input also has no
 * business inside a page component.
 */
export type Track = "group" | "private";

const TRACKS: readonly Track[] = ["group", "private"];

/**
 * Validate `?track=` at the server boundary.
 *
 * Anything unrecognised means "show everything" — never an empty page, never a
 * throw. Next.js hands back `string[]` when a query param is repeated
 * (`?track=a&track=b`), so the array form is a real input, not a hypothetical.
 */
export function parseTrack(raw: string | string[] | undefined): Track | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return TRACKS.includes(value as Track) ? (value as Track) : null;
}

/**
 * Which tracks the page shows for a given `?track=`.
 *
 * Two rules that matter more than they look:
 *  - a null track shows EVERYTHING, so a visitor who ignores the chooser (or a
 *    crawler that never clicks) still sees every plan;
 *  - a track with no plans is dropped, so an empty section never renders a
 *    heading over nothing.
 *
 * Kept pure and separate from the component so the filtering can be asserted
 * directly rather than inferred from rendered HTML.
 */
export function selectVisibleTracks<T extends { key: Track; plans: unknown[] }>(
  tiers: readonly T[],
  track: Track | null,
): T[] {
  const available = tiers.filter((tier) => tier.plans.length > 0);
  return track ? available.filter((tier) => tier.key === track) : available;
}
