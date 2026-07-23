import { getSetting } from "@/lib/settings";
import {
  PREPAID_DEFAULT_RATE_USD as DEFAULT_RATE_USD,
  PREPAID_DEFAULT_CUSTOM_MIN as DEFAULT_CUSTOM_MIN,
  PREPAID_DEFAULT_CUSTOM_MAX as DEFAULT_CUSTOM_MAX,
} from "./prepaid-defaults";

/**
 * Single source of truth for the prepaid-hours CHARGE math
 * (amountCents = hours × rateUsd × 100), shared by the Stripe and PayPal
 * prepaid-hours checkout routes.
 *
 * Before this module the rate/bounds parsing + reset logic was a
 * byte-identical copy in each route. A prior incident ($10-vs-$14
 * undercharge, migration 20260817000000) forced partial centralization of
 * just the fallback constants (prepaid-defaults.ts); this finishes it by
 * centralizing the logic that reads and validates them too.
 *
 * Providers are NOT unified here — Stripe wants integer cents, PayPal wants
 * a dollar amount. Each route derives its own provider-shaped value from
 * `amountCents` / `rateUsd` below.
 */

export class PrepaidHoursOutOfRangeError extends Error {
  constructor(
    public readonly min: number,
    public readonly max: number,
  ) {
    super(`Hours must be between ${min} and ${max}`);
    this.name = "PrepaidHoursOutOfRangeError";
  }
}

export interface PrepaidQuote {
  rateUsd: number;
  min: number;
  max: number;
  amountCents: number;
}

async function readRateUsd(): Promise<number> {
  const raw = await getSetting("prepaid_hours_rate_usd");
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_RATE_USD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RATE_USD;
  // Cents-safe rounding: the rate is a flat USD value; round to 2dp so
  // amount_cents = hours × rate × 100 is an integer.
  return Math.round(n * 100) / 100;
}

async function readCustomBounds(): Promise<{ min: number; max: number }> {
  const readMin = await getSetting("prepaid_hours_custom_min");
  const readMax = await getSetting("prepaid_hours_custom_max");
  const min = (() => {
    if (readMin === null || readMin === undefined || readMin.trim() === "") return DEFAULT_CUSTOM_MIN;
    const n = Number(readMin);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_CUSTOM_MIN;
    return Math.floor(n);
  })();
  const max = (() => {
    if (readMax === null || readMax === undefined || readMax.trim() === "") return DEFAULT_CUSTOM_MAX;
    const n = Number(readMax);
    if (!Number.isFinite(n) || n < min) return DEFAULT_CUSTOM_MAX;
    return Math.floor(n);
  })();
  // Admin can set min > 100 while max is missing/invalid → the IIFE above
  // would yield max=DEFAULT_CUSTOM_MAX=100 < min, rejecting every request
  // ("between 200 and 100"). Reset both to defaults if the final range is
  // inverted, so checkout never hard-fails on a misconfigured bound.
  if (max < min) return { min: DEFAULT_CUSTOM_MIN, max: DEFAULT_CUSTOM_MAX };
  return { min, max };
}

/**
 * Resolves the prepaid-hours charge for a purchase of `hours`: reads the
 * rate + custom bounds from platform_settings (server-only; FR-002) and
 * computes `amountCents`. Throws PrepaidHoursOutOfRangeError when `hours`
 * falls outside the resolved bounds — routes catch this and turn it into
 * their existing 422 response.
 */
export async function resolvePrepaidQuote(hours: number): Promise<PrepaidQuote> {
  const rateUsd = await readRateUsd();
  const { min, max } = await readCustomBounds();

  if (hours < min || hours > max) {
    throw new PrepaidHoursOutOfRangeError(min, max);
  }

  const amountCents = Math.round(hours * rateUsd * 100);
  return { rateUsd, min, max, amountCents };
}
