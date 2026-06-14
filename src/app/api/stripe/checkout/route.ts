import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Create a Stripe Checkout session for a package purchase.
 *
 * STATUS: Stripe SDK is NOT installed. This route validates the request and
 * returns 501 WITHOUT writing to the database. When Stripe keys arrive (Sprint 1):
 *   1. Install: npm i stripe
 *   2. Replace the 501 section below with stripe.checkout.sessions.create({...})
 *   3. Create the `pending` payment row there, keyed by the real PaymentIntent id
 *   4. Use the returned session.url
 *
 * The fulfillment path (webhook → fulfillPackagePurchase → DB rows) is already
 * wired in Phase 15. Only this initiate-side needs the SDK.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();
  if (!profile || profile.role !== "student") {
    return NextResponse.json({ error: "Only students may initiate checkout" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("package_id" in body)) {
    return NextResponse.json({ error: "package_id required" }, { status: 400 });
  }
  const { package_id } = body as { package_id?: unknown };
  if (!package_id) {
    return NextResponse.json({ error: "package_id required" }, { status: 400 });
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof package_id !== "string" || !UUID_RE.test(package_id)) {
    return NextResponse.json({ error: "معرّف الحزمة غير صالح — invalid package_id" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pkg } = await admin
    .from("packages")
    .select("id, price_usd, name")
    .eq("id", package_id)
    .eq("is_active", true)
    .single<{ id: string; price_usd: number; name: string }>();
  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  // SECURITY: do NOT create a `payments` row here. The endpoint returns 501
  // until the Stripe SDK is wired, so a pre-checkout insert would let any
  // authenticated student flood the payments table with orphaned `pending`
  // rows — the Date.now()-suffixed placeholder intent defeats the UNIQUE
  // constraint and there is no rate limit. The pending row must instead be
  // created atomically with the real Stripe session below, keyed by the
  // actual PaymentIntent id.

  // TODO(Sprint 1): Create real Stripe Checkout session + the pending payment row
  // const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  // const session = await stripe.checkout.sessions.create({
  //   mode: "payment",
  //   payment_method_types: ["card"],
  //   line_items: [{
  //     price_data: {
  //       currency: "usd",
  //       product_data: { name: pkg.name },
  //       unit_amount: Math.round(pkg.price_usd * 100),
  //     },
  //     quantity: 1,
  //   }],
  //   metadata: { user_id: user.id, package_id: pkg.id },
  //   success_url: `${process.env.NEXT_PUBLIC_APP_URL}/student/packages?purchase=success`,
  //   cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/student/packages?purchase=cancelled`,
  // });
  // await admin.from("payments").insert({
  //   student_id: user.id,
  //   stripe_payment_intent: session.payment_intent as string,
  //   amount_usd: pkg.price_usd, amount_before_tax: pkg.price_usd,
  //   tax_rate: 0, tax_amount: 0, revenue_recognized: 0, status: "pending",
  // });
  // return NextResponse.json({ url: session.url });

  return NextResponse.json({
    error: "Stripe SDK not yet installed",
    next_step: "Install stripe package and wire checkout creation",
  }, { status: 501 });
}
