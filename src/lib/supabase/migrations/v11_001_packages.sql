-- ============================================================================
-- V11: Packages & Pricing System
-- Database-driven packages, student package tracking, booking integration.
-- Stripe integration handled separately (deferred until API keys ready).
-- ============================================================================

-- ─── 1. packages table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.packages (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  package_type    text         NOT NULL CHECK (package_type IN ('single_session','pack_4','pack_8','pack_12','full_course')),
  name            text         NOT NULL,
  name_ar         text,
  description     text,
  description_ar  text,
  session_count   integer      NOT NULL CHECK (session_count > 0),
  duration_min    integer      NOT NULL DEFAULT 30,
  price_usd       numeric(10,2) NOT NULL CHECK (price_usd > 0),
  price_gbp       numeric(10,2),
  price_sar       numeric(10,2),
  price_aud       numeric(10,2),
  features        text[]       DEFAULT '{}',
  features_ar     text[]       DEFAULT '{}',
  is_featured     boolean      DEFAULT false,
  is_active       boolean      DEFAULT true,
  display_order   integer      DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE TRIGGER t_packages_upd
  BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. student_packages table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.student_packages (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  package_id      uuid         NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  payment_id      uuid         REFERENCES payments(id) ON DELETE RESTRICT,
  sessions_total  integer      NOT NULL CHECK (sessions_total > 0),
  sessions_used   integer      NOT NULL DEFAULT 0,
  status          text         NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  purchased_at    timestamptz  NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now(),

  CONSTRAINT check_sessions_used CHECK (sessions_used <= sessions_total)
);

-- ─── 3. Alter bookings: add student_package_id (nullable for backward compat)

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS student_package_id uuid REFERENCES student_packages(id) ON DELETE RESTRICT;

-- ─── 4. Indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_packages_active ON public.packages(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_student_packages_student ON public.student_packages(student_id, status);
CREATE INDEX IF NOT EXISTS idx_student_packages_status ON public.student_packages(status);
CREATE INDEX IF NOT EXISTS idx_bookings_student_package ON public.bookings(student_package_id);

-- ─── 5. Row Level Security ──────────────────────────────────────────────────

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

-- Anyone can read active packages (public pricing page)
CREATE POLICY "anyone_read_active_packages" ON public.packages
  FOR SELECT USING (is_active = true);

-- Admin: full CRUD on all packages
CREATE POLICY "admin_manage_packages" ON public.packages
  FOR ALL USING (is_admin_or_mod());

ALTER TABLE public.student_packages ENABLE ROW LEVEL SECURITY;

-- Student reads own packages
CREATE POLICY "student_read_own_packages" ON public.student_packages
  FOR SELECT USING (auth.uid() = student_id);

-- Admin/mod: full access
CREATE POLICY "admin_mod_student_packages" ON public.student_packages
  FOR ALL USING (is_admin_or_mod());

-- ─── 6. Atomic session deduction function (prevents race conditions) ────────

CREATE OR REPLACE FUNCTION deduct_package_session(p_package_id uuid)
RETURNS boolean
LANGUAGE sql
AS $$
  UPDATE student_packages
  SET sessions_used = sessions_used + 1
  WHERE id = p_package_id
    AND status = 'active'
    AND sessions_used < sessions_total
    AND (expires_at IS NULL OR expires_at > now())
  RETURNING true;
$$;

-- ─── 7. Seed initial packages ───────────────────────────────────────────────

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

-- ─── 8. Migration record ────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, description)
VALUES ('11.1.0', 'V11: Packages & pricing system with student package tracking')
ON CONFLICT DO NOTHING;
