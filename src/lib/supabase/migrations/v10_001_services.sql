-- V10 Migration: Dynamic services table
-- Already applied to production via supabase CLI on 2026-04-06

CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  title_ar text,
  description text NOT NULL,
  description_ar text,
  features text[] DEFAULT '{}',
  features_ar text[] DEFAULT '{}',
  icon text,
  image_url text,
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone_read_services" ON public.services
  FOR SELECT USING (is_active = true);

CREATE POLICY "admin_manage_services" ON public.services
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = 'admin'::user_role)
  );

CREATE TRIGGER t_services_upd
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
