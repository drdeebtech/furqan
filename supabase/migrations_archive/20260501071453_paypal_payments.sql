-- 20260501071453_paypal_payments.sql
-- PayPal payments support
--
-- Extends the unified `payments` table to accept PayPal-originated rows
-- alongside the existing Stripe rows. Adds a `provider` discriminator and
-- PayPal-specific id columns. Drops NOT NULL on `stripe_payment_intent`
-- because PayPal rows do not have one.
--
-- Also adds the `paypal_purchase_enabled` row to platform_settings so the
-- new flow can be feature-flagged on/off without a deploy. Defaults to
-- false — flip to true after PayPal sandbox creds are wired in env.
--
-- Re-runs the V11 package seed inserts ON CONFLICT DO NOTHING so any
-- environment that missed the original V11 apply gets the 5 catalog rows.

-- ─── 1. Extend payments for PayPal ──────────────────────────────────────────

ALTER TABLE public.payments
  ALTER COLUMN stripe_payment_intent DROP NOT NULL;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider          text         NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe','paypal','manual')),
  ADD COLUMN IF NOT EXISTS paypal_order_id   text         UNIQUE,
  ADD COLUMN IF NOT EXISTS paypal_capture_id text         UNIQUE,
  ADD COLUMN IF NOT EXISTS captured_at       timestamptz,
  ADD COLUMN IF NOT EXISTS payer_email       text,
  ADD COLUMN IF NOT EXISTS package_id        uuid         REFERENCES public.packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_paypal_order ON public.payments(paypal_order_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider     ON public.payments(provider);
CREATE INDEX IF NOT EXISTS idx_payments_package      ON public.payments(package_id);

-- Sanity invariant: a PayPal payment must carry an order id; a Stripe
-- payment must carry a payment-intent id. Manual rows can have neither.
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_provider_id_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_provider_id_check CHECK (
    (provider = 'paypal'  AND paypal_order_id IS NOT NULL) OR
    (provider = 'stripe'  AND stripe_payment_intent IS NOT NULL) OR
    (provider = 'manual')
  );

-- ─── 2. Feature flag default ────────────────────────────────────────────────

INSERT INTO public.platform_settings (key, value)
VALUES ('paypal_purchase_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Re-seed V11 package catalog (no-op if already present) ──────────────

INSERT INTO public.packages
  (package_type, name, name_ar, description, description_ar, session_count, duration_min,
   price_usd, price_gbp, price_sar, price_aud,
   features, features_ar, is_featured, display_order)
VALUES
  ('single_session', 'Single Session', 'جلسة واحدة',
   'Try a single session with no commitment', 'جرّب جلسة واحدة بدون التزام',
   1, 30, 8.00, 5.00, 30.00, 11.00,
   ARRAY['One-time session','Choose any teacher','No commitment'],
   ARRAY['جلسة واحدة','اختر أي معلم','بدون التزام'],
   false, 0),
  ('pack_4', 'Starter', 'الباقة الأساسية',
   '2 days/week · 8 sessions/month', '٢ أيام / أسبوع · ٨ جلسات / شهر',
   8, 30, 40.00, 25.00, 150.00, 55.00,
   ARRAY['Quran reading','Basic Tajweed rules','Prayers and Duas','Monthly progress report'],
   ARRAY['قراءة القرآن','أحكام التجويد الأساسية','الصلوات والأدعية','تقرير تقدم شهري'],
   false, 1),
  ('pack_8', 'Standard', 'الباقة المتوسطة',
   '3 days/week · 12 sessions/month', '٣ أيام / أسبوع · ١٢ جلسة / شهر',
   12, 30, 50.00, 30.00, 185.00, 65.00,
   ARRAY['All Starter features','Short surah memorization','Regular revision','Weekly report'],
   ARRAY['كل مزايا الأساسية','حفظ سور قصيرة','مراجعة منتظمة','تقرير أسبوعي'],
   false, 2),
  ('pack_12', 'Premium', 'الباقة المتقدمة',
   '5 days/week · 20 sessions/month', '٥ أيام / أسبوع · ٢٠ جلسة / شهر',
   20, 45, 65.00, 40.00, 245.00, 85.00,
   ARRAY['All Standard features','Full memorization program','Advanced Tajweed','Daily report','Priority teacher selection'],
   ARRAY['كل مزايا المتوسطة','برنامج حفظ متكامل','تجويد متقدم','تقرير يومي','أولوية في اختيار المعلم'],
   true, 3),
  ('full_course', 'Full Course', 'الدورة الكاملة',
   'Complete Quran course — 60 sessions', 'دورة القرآن الكاملة — ٦٠ جلسة',
   60, 45, 180.00, 110.00, 675.00, 240.00,
   ARRAY['All Premium features','Complete Quran journey','Dedicated teacher','Certificate on completion'],
   ARRAY['كل مزايا المتقدمة','رحلة القرآن الكاملة','معلم مخصص','شهادة عند الإتمام'],
   false, 4)
ON CONFLICT DO NOTHING;
