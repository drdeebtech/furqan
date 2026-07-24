/**
 * PayPal plan bootstrap — GitHub #761 (Phase 4).
 *
 * Creates the two PayPal catalog Products (Group / Individual) plus one monthly
 * Billing Plan per hifz subscription tier, then emits a ready-to-merge SQL
 * migration wiring `subscription_plans.paypal_plan_id` to the resolved PayPal
 * plan ids.
 *
 * IDEMPOTENT: products are discovered by exact catalog product name, and plans
 * are discovered by exact plan name (`furqan-<plan_code>`) under that product.
 * If an existing PayPal plan disagrees with the DB price ladder below, the
 * script fails before creating anything.
 *
 * Run:
 *   PAYPAL_API_BASE=https://api-m.sandbox.paypal.com \
 *   PAYPAL_CLIENT_ID=[REDACTED:client id] \
 *   PAYPAL_CLIENT_SECRET=[REDACTED:client secret] \
 *   npx tsx scripts/paypal-bootstrap-plans.ts
 *
 * Preview without touching PayPal or writing a migration:
 *   npx tsx scripts/paypal-bootstrap-plans.ts --dry-run
 *
 * For live PayPal, non-dry-run writes require:
 *   npx tsx scripts/paypal-bootstrap-plans.ts --live
 */

import "dotenv/config";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

type GetPayPalAccessToken = typeof import("@/lib/paypal/client")["getPayPalAccessToken"];

export type PlanFamily = "Group" | "Individual";

export interface PlanSeed {
  readonly planCode: string;
  readonly priceCents: number;
  readonly family: PlanFamily;
}

export interface ResolvedPlan {
  readonly planCode: string;
  readonly productId: string;
  readonly planId: string;
  readonly reused: boolean;
}

interface CliOptions {
  readonly dryRun: boolean;
  readonly live: boolean;
}

interface PayPalProductSummary {
  readonly id?: string;
  readonly name?: string;
}

interface PayPalProductsPage {
  readonly products?: readonly PayPalProductSummary[];
  readonly total_pages?: number;
}

interface PayPalPlanSummary {
  readonly id?: string;
  readonly name?: string;
  readonly product_id?: string;
}

interface PayPalPlansPage {
  readonly plans?: readonly PayPalPlanSummary[];
  readonly total_pages?: number;
}

interface PayPalFixedPrice {
  readonly value?: string;
  readonly currency_code?: string;
}

interface PayPalBillingCycle {
  readonly tenure_type?: string;
  readonly pricing_scheme?: {
    readonly fixed_price?: PayPalFixedPrice;
  };
}

interface PayPalPlanDetail {
  readonly id?: string;
  readonly name?: string;
  readonly billing_cycles?: readonly PayPalBillingCycle[];
}

interface PayPalCreateProductResponse {
  readonly id?: string;
}

interface PayPalCreatePlanResponse {
  readonly id?: string;
  readonly status?: string;
}

interface PayPalRequestOptions {
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string>>;
  readonly requestId?: string;
}

interface ResolvedProduct {
  readonly family: PlanFamily;
  readonly name: string;
  readonly productId: string;
  readonly reused: boolean;
}

const PLAN_FAMILIES: readonly PlanFamily[] = ["Group", "Individual"] as const;

/** Prices mirror supabase/migrations/20260817000000_hifz_price_ladder.sql. */
export const PLANS: readonly PlanSeed[] = [
  { planCode: "hifz_group_4", priceCents: 1200, family: "Group" },
  { planCode: "hifz_group_6", priceCents: 1500, family: "Group" },
  { planCode: "hifz_group_8", priceCents: 1800, family: "Group" },
  { planCode: "hifz_individual_4h", priceCents: 4400, family: "Individual" },
  { planCode: "hifz_individual_6h", priceCents: 6000, family: "Individual" },
  { planCode: "hifz_individual_8h", priceCents: 7200, family: "Individual" },
] as const;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const require = createRequire(import.meta.url);

function installServerOnlyNoopForOpsScript(): void {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    path: path.dirname(serverOnlyPath),
    exports: {},
    filename: serverOnlyPath,
    loaded: true,
    children: [],
    paths: [],
    require,
    isPreloading: false,
    parent: null,
  } as NodeJS.Module;
}

async function loadGetPayPalAccessToken(): Promise<GetPayPalAccessToken> {
  installServerOnlyNoopForOpsScript();
  const { getPayPalAccessToken } = await import("@/lib/paypal/client");
  return getPayPalAccessToken;
}

export function productNameForFamily(family: PlanFamily): string {
  return `Furqan Hifz ${family}`;
}

export function planNameFor(planCode: string): string {
  return `furqan-${planCode}`;
}

export function isProductionBase(apiBase: string): boolean {
  try {
    return new URL(apiBase).hostname === "api-m.paypal.com";
  } catch {
    return false;
  }
}

function moneyValue(priceCents: number): string {
  return (priceCents / 100).toFixed(2);
}

export function assertPlanPriceMatches(
  plan: PlanSeed,
  actualValue: string,
): void {
  const expected = moneyValue(plan.priceCents);
  if (actualValue !== expected) {
    throw new Error(
      `Existing PayPal plan for "${plan.planCode}" has fixed_price.value ` +
        `${actualValue}; expected ${expected}.`,
    );
  }
}

/** SQL-escape a PayPal id/name (defensive; ids are not secrets). */
function sqlLit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildMigration(
  resolved: readonly ResolvedPlan[],
  generatedAt: string,
): string {
  const updates = resolved
    .map(
      (r) =>
        `update public.subscription_plans set paypal_plan_id = ${sqlLit(
          r.planId,
        )} where plan_code = ${sqlLit(r.planCode)};`,
    )
    .join("\n");

  return (
    `-- PayPal billing plan ids for the six hifz subscription plans.\n` +
    `-- Generated by scripts/paypal-bootstrap-plans.ts on ${generatedAt}.\n` +
    `-- PayPal plan ids are NOT secret — safe to commit.\n\n` +
    `begin;\n\n` +
    `${updates}\n\n` +
    `-- Fail closed: no hifz subscription plan may be missing a PayPal plan id.\n` +
    `do $$\n` +
    `begin\n` +
    `  if exists (\n` +
    `    select 1 from public.subscription_plans\n` +
    `    where is_hifz_product and paypal_plan_id is null\n` +
    `  ) then\n` +
    `    raise exception 'hifz plan missing paypal_plan_id';\n` +
    `  end if;\n` +
    `end $$;\n\n` +
    `commit;\n`
  );
}

/** UTC timestamp `YYYYMMDDHHMMSS` for Supabase migration filenames. */
export function migrationTimestamp(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  );
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  return {
    dryRun: argv.includes("--dry-run"),
    live: argv.includes("--live"),
  };
}

function normalizeTotalPages(totalPages: number | undefined): number {
  return totalPages && totalPages > 0 ? totalPages : 1;
}

function paypalUrl(
  apiBase: string,
  pathname: string,
  query: Readonly<Record<string, string>> = {},
): string {
  const url = new URL(pathname, apiBase);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function paypalRequest<T>(
  apiBase: string,
  accessToken: string,
  op: string,
  method: string,
  pathname: string,
  opts: PayPalRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.requestId) {
    headers["PayPal-Request-Id"] = opts.requestId;
  }

  const res = await fetch(paypalUrl(apiBase, pathname, opts.query), {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (!res.ok) {
    throw new Error(`PayPal ${op} request failed: ${res.status} ${res.statusText}`);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`PayPal ${op} response parse failed`);
  }
}

function requireId(kind: string, name: string, id: string | undefined): string {
  if (!id) {
    throw new Error(`PayPal ${kind} "${name}" response missing id`);
  }
  return id;
}

async function findProductByName(
  apiBase: string,
  accessToken: string,
  name: string,
): Promise<PayPalProductSummary | null> {
  const matches: PayPalProductSummary[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const json = await paypalRequest<PayPalProductsPage>(
      apiBase,
      accessToken,
      "list-products",
      "GET",
      "/v1/catalogs/products",
      {
        query: {
          page: String(page),
          page_size: "20",
          total_required: "true",
        },
      },
    );

    matches.push(...(json.products ?? []).filter((p) => p.name === name));
    totalPages = normalizeTotalPages(json.total_pages);
    page += 1;
  } while (page <= totalPages);

  if (matches.length > 1) {
    const ids = matches.map((p) => p.id ?? "<missing-id>").join(", ");
    throw new Error(`Multiple PayPal products named "${name}" found: ${ids}`);
  }

  return matches[0] ?? null;
}

async function createProduct(
  apiBase: string,
  accessToken: string,
  family: PlanFamily,
): Promise<ResolvedProduct> {
  const name = productNameForFamily(family);
  const json = await paypalRequest<PayPalCreateProductResponse>(
    apiBase,
    accessToken,
    "create-product",
    "POST",
    "/v1/catalogs/products",
    {
      body: {
        name,
        type: "SERVICE",
        category: "SOFTWARE",
      },
      requestId: `furqan-product-${family.toLowerCase()}`,
    },
  );

  return {
    family,
    name,
    productId: requireId("product", name, json.id),
    reused: false,
  };
}

async function resolveProduct(
  apiBase: string,
  accessToken: string,
  family: PlanFamily,
  dryRun: boolean,
): Promise<ResolvedProduct> {
  const name = productNameForFamily(family);
  const existing = await findProductByName(apiBase, accessToken, name);
  if (existing) {
    const productId = requireId("product", name, existing.id);
    console.log(`  • product ${name}: reused ${productId}`);
    return { family, name, productId, reused: true };
  }

  if (dryRun) {
    console.log(`  • product ${name}: WOULD create`);
    return { family, name, productId: `<dry-run:${family}>`, reused: false };
  }

  const product = await createProduct(apiBase, accessToken, family);
  console.log(`  • product ${name}: created ${product.productId}`);
  return product;
}

async function findPlanByName(
  apiBase: string,
  accessToken: string,
  productId: string,
  name: string,
): Promise<PayPalPlanSummary | null> {
  const matches: PayPalPlanSummary[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const json = await paypalRequest<PayPalPlansPage>(
      apiBase,
      accessToken,
      "list-plans",
      "GET",
      "/v1/billing/plans",
      {
        query: {
          product_id: productId,
          page: String(page),
          page_size: "20",
          total_required: "true",
        },
      },
    );

    matches.push(...(json.plans ?? []).filter((p) => p.name === name));
    totalPages = normalizeTotalPages(json.total_pages);
    page += 1;
  } while (page <= totalPages);

  if (matches.length > 1) {
    const ids = matches.map((p) => p.id ?? "<missing-id>").join(", ");
    throw new Error(
      `Multiple PayPal plans named "${name}" found under product ${productId}: ${ids}`,
    );
  }

  return matches[0] ?? null;
}

async function getPlan(
  apiBase: string,
  accessToken: string,
  planId: string,
): Promise<PayPalPlanDetail> {
  return paypalRequest<PayPalPlanDetail>(
    apiBase,
    accessToken,
    "get-plan",
    "GET",
    `/v1/billing/plans/${encodeURIComponent(planId)}`,
  );
}

function planFixedPriceValue(plan: PayPalPlanDetail): string {
  const regularCycle = plan.billing_cycles?.find(
    (cycle) => cycle.tenure_type === "REGULAR",
  );
  const value = regularCycle?.pricing_scheme?.fixed_price?.value;
  if (!value) {
    throw new Error(
      `PayPal plan ${plan.id ?? "<missing-id>"} response missing REGULAR fixed_price.value`,
    );
  }
  return value;
}

async function assertExistingPlanPriceMatches(
  apiBase: string,
  accessToken: string,
  plan: PlanSeed,
  planId: string,
): Promise<void> {
  const detail = await getPlan(apiBase, accessToken, planId);
  assertPlanPriceMatches(plan, planFixedPriceValue(detail));
}

async function assertNoExistingPlanPriceDrift(
  apiBase: string,
  accessToken: string,
): Promise<void> {
  for (const family of PLAN_FAMILIES) {
    const product = await findProductByName(
      apiBase,
      accessToken,
      productNameForFamily(family),
    );
    if (!product?.id) {
      continue;
    }

    for (const plan of PLANS.filter((candidate) => candidate.family === family)) {
      const existing = await findPlanByName(
        apiBase,
        accessToken,
        product.id,
        planNameFor(plan.planCode),
      );
      if (existing?.id) {
        await assertExistingPlanPriceMatches(apiBase, accessToken, plan, existing.id);
      }
    }
  }
}

function createPlanBody(plan: PlanSeed, productId: string): Record<string, unknown> {
  return {
    product_id: productId,
    name: planNameFor(plan.planCode),
    billing_cycles: [
      {
        frequency: {
          interval_unit: "MONTH",
          interval_count: 1,
        },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: {
            value: moneyValue(plan.priceCents),
            currency_code: "USD",
          },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
    },
  };
}

async function createPlan(
  apiBase: string,
  accessToken: string,
  plan: PlanSeed,
  productId: string,
): Promise<string> {
  const name = planNameFor(plan.planCode);
  const json = await paypalRequest<PayPalCreatePlanResponse>(
    apiBase,
    accessToken,
    "create-plan",
    "POST",
    "/v1/billing/plans",
    {
      body: createPlanBody(plan, productId),
      requestId: `furqan-plan-${plan.planCode}`,
    },
  );

  return requireId("plan", name, json.id);
}

async function resolvePlan(
  apiBase: string,
  accessToken: string,
  plan: PlanSeed,
  product: ResolvedProduct,
  dryRun: boolean,
): Promise<ResolvedPlan> {
  const name = planNameFor(plan.planCode);

  if (!product.productId.startsWith("<dry-run:")) {
    const existing = await findPlanByName(apiBase, accessToken, product.productId, name);
    if (existing) {
      const planId = requireId("plan", name, existing.id);
      await assertExistingPlanPriceMatches(apiBase, accessToken, plan, planId);
      console.log(
        `  • ${plan.planCode}: reused plan ${planId} (product ${product.productId})`,
      );
      return {
        planCode: plan.planCode,
        productId: product.productId,
        planId,
        reused: true,
      };
    }
  }

  if (dryRun) {
    console.log(
      `  • ${plan.planCode}: WOULD create plan "${name}" ` +
        `($${moneyValue(plan.priceCents)}/mo, product ${product.name})`,
    );
    return {
      planCode: plan.planCode,
      productId: product.productId,
      planId: "<dry-run>",
      reused: false,
    };
  }

  const planId = await createPlan(apiBase, accessToken, plan, product.productId);
  console.log(
    `  • ${plan.planCode}: created plan ${planId} (product ${product.productId})`,
  );
  return {
    planCode: plan.planCode,
    productId: product.productId,
    planId,
    reused: false,
  };
}

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const { dryRun, live } = parseCliOptions(argv);
  const apiBase = process.env.PAYPAL_API_BASE;

  if (!apiBase) {
    fail(
      "PAYPAL_API_BASE is not set. Set PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_API_BASE.",
    );
  }

  if (isProductionBase(apiBase) && !dryRun && !live) {
    fail("refusing to create LIVE PayPal plans without --live");
  }

  const getPayPalAccessToken = await loadGetPayPalAccessToken();
  const accessToken = await getPayPalAccessToken();

  console.log(
    `\nResolving ${PLANS.length} hifz plans against PayPal ` +
      `(${dryRun ? "DRY RUN — no writes" : "will create missing objects"})...\n`,
  );

  await assertNoExistingPlanPriceDrift(apiBase, accessToken);

  const productsByFamily = new Map<PlanFamily, ResolvedProduct>();
  const resolved: ResolvedPlan[] = [];

  for (const family of PLAN_FAMILIES) {
    productsByFamily.set(
      family,
      await resolveProduct(apiBase, accessToken, family, dryRun),
    );
  }

  for (const plan of PLANS) {
    const product = productsByFamily.get(plan.family);
    if (!product) {
      throw new Error(`No PayPal product resolved for ${plan.family}`);
    }
    resolved.push(await resolvePlan(apiBase, accessToken, plan, product, dryRun));
  }

  if (dryRun) {
    console.log(`\nDry run complete — nothing created, no migration written.\n`);
    return;
  }

  const now = new Date();
  const migration = buildMigration(resolved, now.toISOString());
  const fileName = `${migrationTimestamp(now)}_paypal_plan_ids.sql`;
  const outPath = path.join("supabase", "migrations", fileName);
  await fs.writeFile(outPath, migration, "utf8");

  console.log(`\n✓ Wrote migration: ${outPath}`);
  console.log(`  Review it, then commit + merge to main so Supabase applies it.`);
  console.log(`\n  Resolved ids:`);
  for (const r of resolved) {
    console.log(
      `    ${r.planCode.padEnd(20)} ${r.productId}  ${r.planId}${
        r.reused ? "  (reused)" : ""
      }`,
    );
  }
  console.log();
}

if (process.argv[1] && process.argv[1].endsWith("paypal-bootstrap-plans.ts")) {
  void main().catch((err: unknown) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
