import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Typed `callRpc` seam — pays off the `as never` tax (#185).
 *
 * Custom Postgres functions are missing from the generated types
 * (`src/types/supabase.generated.ts` is stale, #185), so call sites had to
 * double-cast: `supabase.rpc("fn" as never, { ... } as never)`. That double
 * cast erases type-safety on BOTH the args and the result — it is what let a
 * false-success slip through on #367.
 *
 * This helper restores that safety by typing against the hand-maintained
 * canonical signatures in `src/types/database.ts`
 * (`Database["public"]["Functions"]`), NOT the stale generated map. The single
 * `as never` cast lives here, in ONE place; every call site gets a clean,
 * fully-typed surface:
 *
 *   - the function name is constrained to a known function,
 *   - `args` is typed from `Functions[name]["Args"]`,
 *   - the resolved `data` is typed from `Functions[name]["Returns"]`.
 *
 * When the generated types are eventually regenerated and `.rpc()` becomes
 * type-safe on its own, this seam can be retired — but the call sites stay
 * unchanged because they already pass real types.
 */

type Functions = Database["public"]["Functions"];

/** Names of the custom Postgres functions with canonical signatures. */
export type RpcName = keyof Functions;

/** Argument shape for a given custom function (canonical, from database.ts). */
export type RpcArgs<Name extends RpcName> = Functions[Name]["Args"];

/** Return shape for a given custom function (canonical, from database.ts). */
export type RpcReturns<Name extends RpcName> = Functions[Name]["Returns"];

/**
 * The narrow slice of a Supabase client this seam needs: just `.rpc()`.
 *
 * Typed structurally (rather than as `SupabaseClient<Database>`) so it accepts
 * any client regardless of which `Database` generic it was constructed with —
 * the call sites use clients typed against the *generated* `Database`, and we
 * deliberately retype the result against the *canonical* one.
 */
interface RpcClient {
  rpc: (...rpcArgs: never[]) => unknown;
}

/**
 * Call a custom Postgres function with canonical arg/result types.
 *
 * Behaviour-identical to `client.rpc(name, args)` — same builder, same
 * `{ data, error }` resolution, same `.then()`-chainability — but the single
 * `as never` cast is contained here instead of leaking to every call site.
 *
 * Functions whose `Args` is `never` (no parameters) are called with no second
 * argument; all others require their typed args object.
 *
 * @example
 *   const { data, error } = await callRpc(admin, "record_student_progress", {
 *     p_booking_id: id,
 *     // ...rest, fully type-checked against database.ts
 *   });
 *   // `data` is typed as `string` (the new progress row id), not `never`.
 */
export function callRpc<Name extends RpcName>(
  client: RpcClient,
  name: Name,
  ...args: [RpcArgs<Name>] extends [never] ? [] : [args: RpcArgs<Name>]
): PromiseLike<PostgrestSingleResponse<RpcReturns<Name>>> {
  // The ONE place the cast lives. `.rpc()` on the generated-typed client can't
  // see these custom functions (#185); we re-assert the canonical result type.
  // `.bind(client)` preserves `this` — supabase-js `rpc()` reads `this.rest`,
  // so a detached call crashes with "Cannot read properties of undefined
  // (reading 'rest')".
  const rpc = (client.rpc as (
    rpcName: string,
    rpcArgs?: unknown,
  ) => PromiseLike<unknown>).bind(client);
  return rpc(name, args[0]) as PromiseLike<
    PostgrestSingleResponse<RpcReturns<Name>>
  >;
}
