import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveCatalogTiers } from "@/lib/domains/catalog/tiers";

/**
 * GET /api/catalog/hifz — return all active hifz catalog tiers.
 *
 * Auth: any authenticated user (student, guardian, admin).
 * Prices sourced from DB rows — never hardcoded (NFR-001).
 * Response cached at the domain layer (tag `'hifz-catalog'`, TTL 3600s).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tiers = await getActiveCatalogTiers();
    return NextResponse.json({ tiers });
  } catch {
    return NextResponse.json({ error: "Failed to load catalog tiers" }, { status: 500 });
  }
}
