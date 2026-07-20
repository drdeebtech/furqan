-- ─────────────────────────────────────────────────────────────────────────────
-- Hifz subscription price ladder
--
-- Before: both tracks priced every tier at a FLAT per-session rate. Individual
-- was $10.00/session at 4h, 6h AND 8h. Group was worse than flat — it got more
-- expensive at the margin (the 6→8 step cost $2.50/session against $1.50 for
-- 4→6). A student had no economic reason to buy a larger tier, and because
-- prepaid hours were also $10/hr, no economic reason to subscribe at all.
--
-- After: per-session price strictly decreases as the tier grows, and every
-- individual tier undercuts the pay-as-you-go rate.
--
--   plan                  price      per session   note
--   hifz_group_4          $12         $3.00        unchanged
--   hifz_group_6          $15         $2.50        unchanged
--   hifz_group_8          $20 → $18   $2.25
--   hifz_individual_4h    $40 → $44   $11.00
--   hifz_individual_6h    $60         $10.00       unchanged
--   hifz_individual_8h    $80 → $72   $9.00
--   prepaid_hours_rate_usd $10 → $14/hr            on-demand premium
--
-- Data-only, expand/contract safe: no schema change, no column narrowed or
-- removed, nothing live code reads is taken away. Idempotent — re-running is
-- a no-op.
--
-- SCOPED TO PRE-CUTOVER ROWS. Stripe prices are IMMUTABLE. Once a tier points
-- at a live Stripe price object, price_cents must not drift from it, or the DB
-- would advertise one amount while Stripe charges another. The catalog seed
-- (20260617000000) leaves placeholder ids suffixed `_local`; the bootstrap
-- (scripts/stripe-bootstrap-live-plans.ts) swaps them at go-live and fails
-- loudly on any mismatch. Restricting to the `_local` suffix means this
-- migration fires pre-cutover and is a correct no-op afterwards.
-- ─────────────────────────────────────────────────────────────────────────────

update public.subscription_plans sp
set price_cents = v.price_cents
from (values
  ('hifz_group_4',       1200),
  ('hifz_group_6',       1500),
  ('hifz_group_8',       1800),
  ('hifz_individual_4h', 4400),
  ('hifz_individual_6h', 6000),
  ('hifz_individual_8h', 7200)
) as v(plan_code, price_cents)
where sp.plan_code = v.plan_code
  -- right(), not LIKE '%_local': `_` is a LIKE wildcard. This is an exact suffix.
  and right(sp.stripe_price_id, 6) = '_local'
  and sp.price_cents is distinct from v.price_cents;

-- Keep the packages catalog mirror in step. DERIVED from subscription_plans,
-- never hardcoded — the seed builds it as price_cents / 100.0 (20260617000000
-- §11) and a second hardcoded price list is exactly how the two drift apart.
update public.packages p
set price_usd = sp.price_cents / 100.0
from public.subscription_plans sp
where p.subscription_plan_id = sp.id
  and sp.is_hifz_product
  and p.price_usd is distinct from sp.price_cents / 100.0;

-- Pay-as-you-go becomes the flexibility premium, which is what makes every
-- subscription tier a visible saving. Guarded on the seeded default so a
-- deliberate admin change is never stomped. Existing prepaid lots are
-- unaffected: student_packages freezes rate_paid_usd at purchase (spec 038 R8),
-- so this only prices NEW purchases.
update public.platform_settings
set value = '14'
where key = 'prepaid_hours_rate_usd'
  and value = '10';
