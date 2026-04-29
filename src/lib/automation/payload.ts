/**
 * Pure types and canonical serializer for automation events.
 *
 * Lives in its own file (separate from emit.ts) because emit.ts transitively
 * imports `server-only` via the settings/admin-client chain, which makes it
 * un-testable in vitest. The serializer is pure and must remain so — the
 * n8n verifier mirrors this exact byte contract.
 */

export interface EventPayload {
  event: string;
  occurred_at: string;
  entity_type: string;
  entity_id: string;
  actor_id?: string | null;
  trace_id: string;
  source: "furqan-app";
  data: Record<string, unknown>;
}

/**
 * Canonical serialization of an EventPayload for HMAC signing.
 *
 * Contract (mirrored on the n8n verifier side):
 *   - Top-level fields appear in the explicit order below.
 *   - `data` keys are sorted alphabetically (immediate level only — nested
 *     objects keep their insertion order).
 *   - No extra whitespace; standard JSON.stringify number/string/null/bool
 *     formatting.
 *
 * Any change here is a breaking change to the n8n verifier and requires a
 * coordinated deploy.
 */
export function serializePayload(payload: EventPayload): string {
  const sortedData: Record<string, unknown> = {};
  for (const key of Object.keys(payload.data).sort()) {
    sortedData[key] = payload.data[key];
  }
  return JSON.stringify({
    event: payload.event,
    occurred_at: payload.occurred_at,
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    actor_id: payload.actor_id,
    trace_id: payload.trace_id,
    source: payload.source,
    data: sortedData,
  });
}
