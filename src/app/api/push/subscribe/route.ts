import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSafePushEndpoint, isSafePushEndpointResolved } from "@/lib/push/safe-endpoint";

const subscriptionSchema = z.object({
  // SSRF guard (SSRF-VULN-01): a real push endpoint is a public HTTPS FQDN.
  // Reject IP-literals and internal hosts so we never persist an outbound
  // destination pointed at metadata/internal services.
  endpoint: z.url().refine(isSafePushEndpoint, {
    message: "endpoint must be a public https push service",
  }),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = subscriptionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;
  if (!(await isSafePushEndpointResolved(endpoint))) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  // An endpoint identifies one browser. A fresh subscription proves the current
  // session controls that browser now, so transfer ownership atomically: clear
  // any existing row for this endpoint first. It may belong to a *different*
  // user (e.g. a shared device switching accounts); there is deliberately no
  // UPDATE policy, so a cross-owner upsert would hit RLS. Admin scope is
  // required to delete another user's row; global endpoint uniqueness is kept
  // because exactly one row per endpoint survives.
  const admin = createAdminClient();
  const { error: clearError } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (clearError) {
    return NextResponse.json({ error: "Subscription failed" }, { status: 500 });
  }

  // Insert under the session user; the RLS insert policy enforces
  // user_id = auth.uid(), so a body-supplied id can never take effect.
  const { error } = await supabase.from("push_subscriptions").insert({
    endpoint,
    keys_p256dh: keys.p256dh,
    keys_auth: keys.auth,
    user_id: user.id,
    user_agent: request.headers.get("user-agent"),
    last_seen_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: "Subscription failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
