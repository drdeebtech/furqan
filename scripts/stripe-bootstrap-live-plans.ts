/**
 * Stripe live-plan bootstrap — spec 024 go-live (item #3).
 *
 * Creates the six hifz subscription Products + recurring-monthly Prices in the
 * live Stripe account, then emits a ready-to-merge SQL migration that swaps the
 * placeholder `stripe_product_id` / `stripe_price_id` values seeded by
 * `supabase/migrations/20260617000000_catalog_credit_redesign.sql` (§10) for the
 * real live ids. See memory `project_stripe_golive_runbook` for the full sequence.
 *
 * WHY this exists: hand-creating 6 products and transcribing 12 ids into a
 * migration is the most error-prone step of go-live — one typo silently breaks a
 * tier. This automates creation + SQL generation and is fully idempotent.
 *
 * IDEMPOTENT: each Price is tagged `lookup_key = <plan_code>` (unique per Stripe
 * account/mode). Re-runs reuse the existing Price+Product instead of duplicating.
 * If an existing Price's amount/interval/currency disagrees with the catalog
 * below, the script FAILS LOUDLY (Stripe prices are immutable) rather than
 * silently pointing a tier at a wrong-priced live object.
 *
 * Run (after the live account exists):
 *   STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/stripe-bootstrap-live-plans.ts
 *   # preview without touching Stripe / writing files:
 *   STRIPE_SECRET_KEY=sk_live_xxx npx tsx scripts/stripe-bootstrap-live-plans.ts --dry-run
 *
 * The catalog below MIRRORS migration 20260617000000 §10. If the seeded plans
 * change, update both. (price_cents is the binding source of truth in the DB;
 * this list must match it exactly or the script errors on amount mismatch.)
 */

import "dotenv/config";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import Stripe from "stripe";

/** One row per seeded plan in subscription_plans (migration 20260617000000 §10). */
interface PlanSeed {
  readonly planCode: string;
  readonly name: string;
  readonly priceCents: number;
  readonly currency: string;
}

const PLANS: readonly PlanSeed[] = [
  { planCode: "hifz_group_4", name: "Hifz Group — 4 sessions/month", priceCents: 1200, currency: "usd" },
  { planCode: "hifz_group_6", name: "Hifz Group — 6 sessions/month", priceCents: 1500, currency: "usd" },
  { planCode: "hifz_group_8", name: "Hifz Group — 8 sessions/month", priceCents: 2000, currency: "usd" },
  { planCode: "hifz_individual_4h", name: "Hifz Individual — 4 hours/month", priceCents: 4000, currency: "usd" },
  { planCode: "hifz_individual_6h", name: "Hifz Individual — 6 hours/month", priceCents: 6000, currency: "usd" },
  { planCode: "hifz_individual_8h", name: "Hifz Individual — 8 hours/month", priceCents: 8000, currency: "usd" },
] as const;

interface ResolvedPlan {
  readonly planCode: string;
  readonly productId: string;
  readonly priceId: string;
  readonly reused: boolean;
}

const DRY_RUN = process.argv.includes("--dry-run");

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** Find an existing recurring Price by its lookup_key (== plan_code), or null. */
async function findPriceByLookupKey(
  stripe: Stripe,
  planCode: string,
): Promise<Stripe.Price | null> {
  const res = await stripe.prices.list({
    lookup_keys: [planCode],
    active: true,
    expand: ["data.product"],
    limit: 1,
  });
  return res.data[0] ?? null;
}

/** Assert an existing price matches the catalog exactly (prices are immutable). */
function assertPriceMatches(plan: PlanSeed, price: Stripe.Price): void {
  const mismatches: string[] = [];
  if (price.unit_amount !== plan.priceCents) {
    mismatches.push(`amount ${price.unit_amount} != expected ${plan.priceCents}`);
  }
  if (price.currency !== plan.currency) {
    mismatches.push(`currency ${price.currency} != expected ${plan.currency}`);
  }
  if (price.recurring?.interval !== "month") {
    mismatches.push(`interval ${price.recurring?.interval ?? "<none>"} != month`);
  }
  if (mismatches.length > 0) {
    fail(
      `Existing live price for "${plan.planCode}" (${price.id}) disagrees with the ` +
        `catalog: ${mismatches.join("; ")}. Stripe prices are immutable — archive the ` +
        `stale price (or change its lookup_key) in the dashboard, then re-run.`,
    );
  }
}

async function resolvePlan(stripe: Stripe, plan: PlanSeed): Promise<ResolvedPlan> {
  const existing = await findPriceByLookupKey(stripe, plan.planCode);
  if (existing) {
    assertPriceMatches(plan, existing);
    const productId =
      typeof existing.product === "string" ? existing.product : existing.product.id;
    console.log(`  • ${plan.planCode}: reused price ${existing.id} (product ${productId})`);
    return { planCode: plan.planCode, productId, priceId: existing.id, reused: true };
  }

  if (DRY_RUN) {
    console.log(
      `  • ${plan.planCode}: WOULD create product "${plan.name}" + ` +
        `$${(plan.priceCents / 100).toFixed(2)}/mo price (lookup_key=${plan.planCode})`,
    );
    return { planCode: plan.planCode, productId: "<dry-run>", priceId: "<dry-run>", reused: false };
  }

  // Idempotency-key the creation so a retry after a network blip doesn't dup.
  const product = await stripe.products.create(
    { name: plan.name, metadata: { plan_code: plan.planCode } },
    { idempotencyKey: `furqan-product-${plan.planCode}` },
  );
  const price = await stripe.prices.create(
    {
      product: product.id,
      unit_amount: plan.priceCents,
      currency: plan.currency,
      recurring: { interval: "month" },
      lookup_key: plan.planCode,
      transfer_lookup_key: true,
      metadata: { plan_code: plan.planCode },
    },
    { idempotencyKey: `furqan-price-${plan.planCode}` },
  );
  console.log(`  • ${plan.planCode}: created price ${price.id} (product ${product.id})`);
  return { planCode: plan.planCode, productId: product.id, priceId: price.id, reused: false };
}

/** SQL-escape a Stripe id (defensive — ids are [A-Za-z0-9_], but never trust). */
function sqlLit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildMigration(resolved: readonly ResolvedPlan[], generatedAt: string): string {
  const updates = resolved
    .map(
      (r) =>
        `update public.subscription_plans set\n` +
        `  stripe_product_id = ${sqlLit(r.productId)},\n` +
        `  stripe_price_id   = ${sqlLit(r.priceId)}\n` +
        `where plan_code = ${sqlLit(r.planCode)};`,
    )
    .join("\n\n");

  return (
    `-- Stripe live price ids for the six hifz subscription plans.\n` +
    `-- Generated by scripts/stripe-bootstrap-live-plans.ts on ${generatedAt}.\n` +
    `-- Replaces the placeholder ids seeded by 20260617000000 §10. Price ids are\n` +
    `-- NOT secret (sent to the client during checkout) — safe to commit.\n\n` +
    `begin;\n\n` +
    `${updates}\n\n` +
    `-- Fail closed: no hifz plan may still point at a local placeholder.\n` +
    `do $$\n` +
    `begin\n` +
    `  if exists (\n` +
    `    select 1 from public.subscription_plans\n` +
    `    where is_hifz_product and (stripe_price_id like '%_local' or stripe_product_id like '%_local')\n` +
    `  ) then\n` +
    `    raise exception 'placeholder Stripe id still present in subscription_plans';\n` +
    `  end if;\n` +
    `end $$;\n\n` +
    `commit;\n`
  );
}

/** UTC timestamp `YYYYMMDDHHMMSS` — sorts after the latest existing migration. */
function migrationTimestamp(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  );
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    fail("STRIPE_SECRET_KEY is not set. Run: STRIPE_SECRET_KEY=sk_live_… npx tsx scripts/stripe-bootstrap-live-plans.ts");
  }
  if (!key.startsWith("sk_live_")) {
    console.warn(
      `⚠ STRIPE_SECRET_KEY does not start with "sk_live_" — this looks like a ` +
        `TEST key. Continuing (useful for rehearsal), but the emitted migration ` +
        `would carry TEST ids. Ctrl-C now if that's not intended.\n`,
    );
  }

  const stripe = new Stripe(key, { apiVersion: "2026-06-24.dahlia" });

  console.log(
    `\nResolving ${PLANS.length} hifz plans against Stripe ` +
      `(${DRY_RUN ? "DRY RUN — no writes" : "live — will create missing objects"})…\n`,
  );

  const resolved: ResolvedPlan[] = [];
  for (const plan of PLANS) {
    resolved.push(await resolvePlan(stripe, plan));
  }

  if (DRY_RUN) {
    console.log(`\nDry run complete — nothing created, no migration written.\n`);
    return;
  }

  const now = new Date();
  const migration = buildMigration(resolved, now.toISOString());
  const fileName = `${migrationTimestamp(now)}_stripe_live_price_ids.sql`;
  const outPath = path.join("supabase", "migrations", fileName);
  await fs.writeFile(outPath, migration, "utf8");

  console.log(`\n✓ Wrote migration: ${outPath}`);
  console.log(`  Review it, then commit + merge to main — CI (supabase-migrate.yml)`);
  console.log(`  applies it to prod. Then set the two Stripe secrets in Vercel and redeploy.`);
  console.log(`\n  Resolved ids:`);
  for (const r of resolved) {
    console.log(`    ${r.planCode.padEnd(20)} ${r.productId}  ${r.priceId}${r.reused ? "  (reused)" : ""}`);
  }
  console.log();
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
