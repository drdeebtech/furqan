-- Run this in Supabase SQL Editor
-- Fixes: admin cannot update other users' profiles (role change, activation)

-- Allow admins to update ANY profile (not just their own)
CREATE POLICY profiles_admin_update ON profiles
  FOR UPDATE
  USING (is_admin());

-- Allow admins to insert into teacher_profiles for any user
CREATE POLICY tp_admin_insert ON teacher_profiles
  FOR INSERT
  WITH CHECK (is_admin());

-- Allow admins to delete from teacher_profiles (for role reversion)
CREATE POLICY tp_admin_delete ON teacher_profiles
  FOR DELETE
  USING (is_admin());
