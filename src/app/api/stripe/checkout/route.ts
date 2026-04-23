import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Create a Stripe Checkout session for a package purchase.
 *
 * STATUS: Stripe SDK is NOT installed. This route inserts a `pending` payment
 * row and returns a mock redirect URL so the full purchase flow can be tested
 * end-to-end once the UI is wired. When Stripe keys arrive (Sprint 1):
 *   1. Install: npm i stripe
 *   2. Replace the mock section below with stripe.checkout.sessions.create({...})
 *   3. Use the returned session.url instead of the mock
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

  let body: { package_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.package_id) {
    return NextResponse.json({ error: "package_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: pkg } = await admin
    .from("packages")
    .select("id, price_usd, name")
    .eq("id", body.package_id)
    .eq("is_active", true)
    .single<{ id: string; price_usd: number; name: string }>();
  if (!pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 });

  // Insert pending payment so we have a pre-checkout audit trail
  // (stripe_payment_intent is blank until the webhook lands — `pending_${userId}_${pkgId}_${ts}`
  // is a placeholder the webhook will overwrite with the real PI ID)
  const placeholderIntent = `pending_${user.id.slice(0, 8)}_${pkg.id.slice(0, 8)}_${Date.now()}`;
  await admin.from("payments").insert({
    student_id: user.id,
    stripe_payment_intent: placeholderIntent,
    amount_usd: pkg.price_usd,
    amount_before_tax: pkg.price_usd,
    tax_rate: 0,
    tax_amount: 0,
    revenue_recognized: 0,
    status: "pending",
  } as never);

  // TODO(Sprint 1): Create real Stripe Checkout session
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
  // return NextResponse.json({ url: session.url });

  return NextResponse.json({
    error: "Stripe SDK not yet installed",
    pending_payment_id: placeholderIntent,
    next_step: "Install stripe package and wire checkout creation",
  }, { status: 501 });
}
