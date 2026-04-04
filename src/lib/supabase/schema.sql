-- ╔═══════════════════════════════════════════════════════════════════════════════╗
-- ║  FURQAN Academy — Complete Schema V8                                        ║
-- ║  20 tables · 16 triggers · 22 RLS policies                                 ║
-- ║  Paste into Supabase SQL Editor and run once.                               ║
-- ╚═══════════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. EXTENSIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";   -- required for EXCLUDE USING gist on bookings

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENUMS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE user_role      AS ENUM ('student', 'teacher', 'admin');
CREATE TYPE gender_type    AS ENUM ('male', 'female');
CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
CREATE TYPE session_type   AS ENUM ('hifz', 'muraja', 'tajweed', 'tilawa', 'qiraat', 'tafsir', 'combined', 'other');
CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'refunded');
CREATE TYPE msg_type       AS ENUM ('text', 'audio', 'file');
CREATE TYPE notif_type     AS ENUM ('booking', 'payment', 'message', 'reminder', 'system');
CREATE TYPE student_level  AS ENUM ('beginner', 'intermediate', 'advanced');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SHARED FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND deleted_at IS NULL
      AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TABLE 1 — profiles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id         uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       user_role   NOT NULL DEFAULT 'student',
  full_name  text,
  avatar_url text,
  phone      text        CHECK (phone ~ '^\+?[0-9]{7,15}$'),
  country    text,
  timezone   text        NOT NULL DEFAULT 'UTC',
  lang       text        NOT NULL DEFAULT 'ar',
  is_active  boolean     NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Trigger: auto-create profile on auth.users INSERT
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Trigger: auto-update updated_at
CREATE TRIGGER t_profiles_upd
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TABLE 2 — teacher_profiles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE teacher_profiles (
  id                    uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id            uuid          UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bio                   text,
  specialties           text[]        NOT NULL DEFAULT '{}',
  recitation_standards  text[]        NOT NULL DEFAULT '{hafs}'
                                      CHECK (recitation_standards <@ ARRAY['hafs','warsh','qalon','al_duri','shu_ba']),
  languages             text[]        NOT NULL DEFAULT '{ar}',
  hourly_rate           numeric(10,2) NOT NULL CHECK (hourly_rate BETWEEN 1 AND 500),
  gender                gender_type,
  intro_video_url       text,
  max_active_students   integer,
  rating_avg            numeric(3,2)  NOT NULL DEFAULT 0 CHECK (rating_avg BETWEEN 0 AND 5),
  total_sessions        integer       NOT NULL DEFAULT 0,
  is_accepting          boolean       NOT NULL DEFAULT true,
  is_archived           boolean       NOT NULL DEFAULT false,
  archived_at           timestamptz,
  created_at            timestamptz   NOT NULL DEFAULT NOW(),
  updated_at            timestamptz   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER t_tp_upd
  BEFORE UPDATE ON teacher_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. TABLE 3 — teacher_ijaza
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE teacher_ijaza (
  id           uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  riwaya       text        NOT NULL CHECK (riwaya IN ('hafs','warsh','qalon','al_duri','shu_ba')),
  chain_text   text        NOT NULL,
  granted_by   text,
  granted_at   date,
  document_url text,
  verified_by  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_teacher_ijaza_teacher ON teacher_ijaza(teacher_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. TABLE 4 — refund_policies
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE refund_policies (
  id                uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  hours_before_min  integer       NOT NULL,
  hours_before_max  integer,
  refund_percentage numeric(5,2)  NOT NULL CHECK (refund_percentage BETWEEN 0 AND 100),
  description       text,
  is_active         boolean       NOT NULL DEFAULT true,
  sort_order        integer       NOT NULL DEFAULT 0,
  created_at        timestamptz   NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_hours_range CHECK (hours_before_max IS NULL OR hours_before_max > hours_before_min)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. TABLE 5 — payments  (booking_id FK added AFTER bookings table)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE payments (
  id                     uuid            PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id             uuid            UNIQUE,   -- FK deferred below
  student_id             uuid            NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  stripe_payment_intent  text            UNIQUE NOT NULL,
  amount_usd             numeric(10,2)   NOT NULL CHECK (amount_usd > 0),
  amount_local           numeric(12,2),
  local_currency         text            CHECK (local_currency = UPPER(local_currency)),
  exchange_rate_snapshot numeric(10,6),
  amount_before_tax      numeric(10,2)   NOT NULL DEFAULT 0,
  tax_rate               numeric(5,2)    NOT NULL DEFAULT 0,
  tax_amount             numeric(10,2)   NOT NULL DEFAULT 0,
  revenue_recognized     numeric(10,2)   NOT NULL DEFAULT 0,
  status                 payment_status  NOT NULL DEFAULT 'pending',
  paid_at                timestamptz,
  created_at             timestamptz     NOT NULL DEFAULT NOW(),

  CONSTRAINT payment_tax_check CHECK (amount_usd = amount_before_tax + tax_amount)
);

CREATE INDEX idx_payments_status     ON payments(status);
CREATE INDEX idx_payments_student    ON payments(student_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. TABLE 6 — payment_transactions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE payment_transactions (
  id          uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id  uuid          NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  type        text          NOT NULL CHECK (type IN ('charge','refund','adjustment')),
  amount_usd  numeric(10,2) NOT NULL CHECK (amount_usd > 0),
  stripe_id   text          UNIQUE,
  description text,
  created_at  timestamptz   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_transactions_payment ON payment_transactions(payment_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. TABLE 7 — student_credits
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE student_credits (
  id              uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      uuid          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  teacher_id      uuid          REFERENCES profiles(id) ON DELETE RESTRICT,
  total           integer       NOT NULL CHECK (total > 0),
  used            integer       NOT NULL DEFAULT 0,
  credit_value_usd numeric(10,2),
  expires_at      timestamptz,
  source          text          NOT NULL DEFAULT 'purchase'
                                CHECK (source IN ('purchase','refund','gift','admin')),
  payment_id      uuid          REFERENCES payments(id) ON DELETE RESTRICT,
  created_at      timestamptz   NOT NULL DEFAULT NOW(),

  CONSTRAINT credits_used_check CHECK (used <= total)
);

CREATE INDEX idx_credits_available ON student_credits(student_id, teacher_id, expires_at)
  WHERE used < total;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. TABLE 8 — teacher_availability  (NO created_at / updated_at)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE teacher_availability (
  id            uuid    PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id    uuid    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day_of_week   integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    time    NOT NULL,
  end_time      time    NOT NULL,
  slot_duration integer NOT NULL DEFAULT 60 CHECK (slot_duration IN (30, 45, 60)),
  is_active     boolean NOT NULL DEFAULT true,

  CONSTRAINT avail_time_order CHECK (end_time > start_time),
  CONSTRAINT avail_unique     UNIQUE (teacher_id, day_of_week, start_time)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. TABLE 9 — availability_exceptions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE availability_exceptions (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  start_time  time,
  end_time    time,
  is_blocked  boolean     NOT NULL DEFAULT true,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT exception_time_order CHECK (
    start_time IS NULL OR end_time IS NULL OR end_time > start_time
  )
);

CREATE INDEX idx_avail_exceptions ON availability_exceptions(teacher_id, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. TABLE 10 — bookings
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE bookings (
  id                uuid            PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id        uuid            NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  teacher_id        uuid            NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_by        uuid            REFERENCES profiles(id) ON DELETE SET NULL,
  rescheduled_from  uuid            REFERENCES bookings(id) ON DELETE SET NULL,
  refund_policy_id  uuid            REFERENCES refund_policies(id) ON DELETE RESTRICT,
  scheduled_at      timestamptz     NOT NULL,
  duration_min      integer         NOT NULL CHECK (duration_min IN (30, 45, 60)),
  status            booking_status  NOT NULL DEFAULT 'pending',
  session_type      session_type    NOT NULL DEFAULT 'hifz',
  rate_snapshot     numeric(10,2)   NOT NULL,
  amount_usd        numeric(10,2)   NOT NULL CHECK (amount_usd > 0),
  amount_local      numeric(12,2),
  local_currency    text            CHECK (local_currency = UPPER(local_currency)),
  exchange_rate     numeric(10,6),
  tax_rate          numeric(5,2)    NOT NULL DEFAULT 0,
  tax_amount        numeric(10,2)   NOT NULL DEFAULT 0,
  notes             text,
  cancelled_by      uuid            REFERENCES profiles(id) ON DELETE SET NULL,
  cancel_reason     text,
  cancelled_at      timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz     NOT NULL DEFAULT NOW(),

  CONSTRAINT no_self_booking    CHECK (student_id != teacher_id),
  CONSTRAINT no_self_reschedule CHECK (rescheduled_from IS NULL OR rescheduled_from != id),
  CONSTRAINT no_booking_overlap EXCLUDE USING gist (
    teacher_id WITH =,
    tstzrange(scheduled_at, scheduled_at + (duration_min * INTERVAL '1 minute')) WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'))
);

CREATE INDEX idx_bookings_teacher_sched ON bookings(teacher_id, scheduled_at)
  WHERE status NOT IN ('cancelled', 'no_show');
CREATE INDEX idx_bookings_student ON bookings(student_id);
CREATE INDEX idx_bookings_status  ON bookings(status);

-- ── Deferred FK: payments.booking_id → bookings.id ──
ALTER TABLE payments
  ADD CONSTRAINT fk_payments_booking
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. TABLE 11 — sessions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE sessions (
  id                 uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id         uuid        UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_name          text        UNIQUE NOT NULL DEFAULT ('furqan-' || REPLACE(uuid_generate_v4()::text, '-', '')),
  room_url           text        NOT NULL,
  expires_at         timestamptz,
  created_via        text        NOT NULL DEFAULT 'auto' CHECK (created_via IN ('webhook','manual','auto')),
  started_at         timestamptz,
  ended_at           timestamptz,
  actual_duration    integer,
  recording_url      text,
  teacher_joined     boolean     NOT NULL DEFAULT false,
  student_joined     boolean     NOT NULL DEFAULT false,
  post_session_notes text,
  homework           text,
  created_at         timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT session_time_order CHECK (
    ended_at IS NULL OR started_at IS NULL OR ended_at > started_at
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. TABLE 12 — conversations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE conversations (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  teacher_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  initiated_by    uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT conv_unique    UNIQUE (student_id, teacher_id),
  CONSTRAINT no_self_conv   CHECK (student_id != teacher_id)
);

CREATE INDEX idx_conv_student ON conversations(student_id, last_message_at DESC);
CREATE INDEX idx_conv_teacher ON conversations(teacher_id, last_message_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. TABLE 13 — messages
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE messages (
  id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  content         text        NOT NULL CHECK (LENGTH(content) BETWEEN 1 AND 5000),
  msg_type        msg_type    NOT NULL DEFAULT 'text',
  file_url        text,
  is_read         boolean     NOT NULL DEFAULT false,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. TABLE 14 — student_progress
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE student_progress (
  id              uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id      uuid          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  teacher_id      uuid          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  booking_id      uuid          NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  progress_type   text          NOT NULL DEFAULT 'new'
                                CHECK (progress_type IN ('new','muraja','correction')),
  surah_from      integer       CHECK (surah_from BETWEEN 1 AND 114),
  ayah_from       integer,
  surah_to        integer       CHECK (surah_to BETWEEN 1 AND 114),
  ayah_to         integer,
  pages_reviewed  integer       CHECK (pages_reviewed >= 0),
  quality_rating  integer       CHECK (quality_rating BETWEEN 1 AND 5),
  level           student_level NOT NULL DEFAULT 'beginner',
  teacher_notes   text,
  created_at      timestamptz   NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_progress_per_booking UNIQUE (student_id, booking_id),
  CONSTRAINT valid_progress_range CHECK (
    (surah_from IS NULL AND surah_to IS NULL)
    OR (
      surah_from IS NOT NULL AND surah_to IS NOT NULL AND (
        surah_to > surah_from
        OR (surah_to = surah_from
            AND ayah_from IS NOT NULL AND ayah_to IS NOT NULL
            AND ayah_to >= ayah_from)
      )
    )
  )
);

CREATE INDEX idx_progress_student ON student_progress(student_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. TABLE 15 — recitation_errors
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE recitation_errors (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  progress_id uuid        NOT NULL REFERENCES student_progress(id) ON DELETE CASCADE,
  surah_num   integer     CHECK (surah_num BETWEEN 1 AND 114),
  ayah_num    integer     NOT NULL,
  error_type  text        NOT NULL CHECK (error_type IN ('makharij','sifat','madd','waqf','ghunna','other')),
  note        text,
  resolved    boolean     NOT NULL DEFAULT false,
  resolved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recitation_errors ON recitation_errors(progress_id, resolved);

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. TABLE 16 — reviews
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE reviews (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  uuid        UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  student_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  teacher_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  rating      integer     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  teacher_reply text,
  is_public   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_teacher ON reviews(teacher_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. TABLE 17 — notifications
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE notifications (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       notif_type  NOT NULL,
  channel    text[]      NOT NULL DEFAULT '{in_app}'
                         CHECK (channel <@ ARRAY['in_app','email','push']),
  title      text        NOT NULL,
  body       text,
  data       jsonb,
  is_read    boolean     NOT NULL DEFAULT false,
  expires_at timestamptz DEFAULT (NOW() + INTERVAL '30 days'),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. TABLE 18 — invoices
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS invoice_seq START WITH 1;

CREATE TABLE invoices (
  id                     uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id             uuid          UNIQUE NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  student_id             uuid          NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  invoice_number         text          UNIQUE NOT NULL,
  issued_at              timestamptz   NOT NULL DEFAULT NOW(),
  pdf_url                text,
  student_name_snapshot  text          NOT NULL,
  amount_usd             numeric(10,2) NOT NULL,
  tax_amount             numeric(10,2) NOT NULL DEFAULT 0,
  currency               text          NOT NULL,
  exchange_rate_snapshot numeric(10,6),
  created_at             timestamptz   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 21. TABLE 19 — audit_log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
  id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  changed_by uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  table_name text        NOT NULL,
  record_id  uuid        NOT NULL,
  action     text        NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data   jsonb,
  new_data   jsonb,
  reason     text,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_created      ON audit_log(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 22. TABLE 20 — schema_migrations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE schema_migrations (
  version     text        PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT NOW(),
  description text,
  applied_by  text
);

-- ═════════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Booking: validate status transitions ─────────────────────────────────────

CREATE OR REPLACE FUNCTION validate_booking_status()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF is_admin() THEN RETURN NEW; END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('confirmed', 'cancelled') THEN
    RETURN NEW;
  ELSIF OLD.status = 'confirmed' AND NEW.status IN ('completed', 'cancelled', 'no_show') THEN
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'Invalid status transition: % → %', OLD.status, NEW.status;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_validate_booking_status
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION validate_booking_status();

-- ── Booking: lock rate_snapshot after set ─────────────────────────────────────

CREATE OR REPLACE FUNCTION lock_rate_snapshot()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.rate_snapshot IS NOT NULL
     AND OLD.rate_snapshot IS DISTINCT FROM NEW.rate_snapshot
     AND NOT is_admin()
  THEN
    RAISE EXCEPTION 'rate_snapshot is immutable once set';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_lock_rate_snapshot
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION lock_rate_snapshot();

-- ── Booking: lock refund_policy_id after set ─────────────────────────────────

CREATE OR REPLACE FUNCTION lock_refund_policy()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.refund_policy_id IS NOT NULL
     AND OLD.refund_policy_id IS DISTINCT FROM NEW.refund_policy_id
     AND NOT is_admin()
  THEN
    RAISE EXCEPTION 'refund_policy_id is immutable once set';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_lock_refund_policy
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION lock_refund_policy();

-- ── Booking: lock scheduled_at + duration_min when confirmed ─────────────────

CREATE OR REPLACE FUNCTION lock_confirmed_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('confirmed', 'completed') AND NOT is_admin() THEN
    IF OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at THEN
      RAISE EXCEPTION 'scheduled_at is locked after confirmation';
    END IF;
    IF OLD.duration_min IS DISTINCT FROM NEW.duration_min THEN
      RAISE EXCEPTION 'duration_min is locked after confirmation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_lock_confirmed_fields
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION lock_confirmed_fields();

-- ── Booking: auto-set cancelled_at ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_cancelled_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'no_show') AND OLD.status NOT IN ('cancelled', 'no_show') THEN
    NEW.cancelled_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_set_cancelled_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_cancelled_at();

-- ── Booking: validate session_type against teacher specialties ───────────────

CREATE OR REPLACE FUNCTION validate_session_type()
RETURNS TRIGGER AS $$
DECLARE
  teacher_specialties text[];
BEGIN
  SELECT specialties INTO teacher_specialties
  FROM teacher_profiles
  WHERE teacher_id = NEW.teacher_id;

  IF teacher_specialties IS NOT NULL
     AND array_length(teacher_specialties, 1) > 0
     AND NOT (NEW.session_type::text = ANY(teacher_specialties))
  THEN
    RAISE EXCEPTION 'Teacher does not offer session type: %', NEW.session_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_validate_session_type
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION validate_session_type();

-- ── Booking completed: inc teacher sessions + revenue_recognized ─────────────

CREATE OR REPLACE FUNCTION inc_teacher_sessions()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE teacher_profiles
    SET total_sessions = total_sessions + 1
    WHERE teacher_id = NEW.teacher_id;

    UPDATE payments
    SET revenue_recognized = revenue_recognized + (NEW.rate_snapshot * (NEW.duration_min / 60.0))
    WHERE booking_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_inc_teacher_sessions
  AFTER UPDATE ON bookings
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status != 'completed')
  EXECUTE FUNCTION inc_teacher_sessions();

-- ── Credits: deduct on confirmed ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION deduct_student_credit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'confirmed' AND OLD.status = 'pending' THEN
    UPDATE student_credits
    SET used = used + 1
    WHERE student_id = NEW.student_id
      AND (teacher_id IS NULL OR teacher_id = NEW.teacher_id)
      AND used < total
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY expires_at ASC NULLS LAST
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_deduct_student_credit
  AFTER UPDATE ON bookings
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed' AND OLD.status = 'pending')
  EXECUTE FUNCTION deduct_student_credit();

-- ── Credits: restore on cancelled ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION restore_student_credit()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status = 'confirmed' THEN
    UPDATE student_credits
    SET used = GREATEST(used - 1, 0)
    WHERE student_id = NEW.student_id
      AND (teacher_id IS NULL OR teacher_id = NEW.teacher_id)
      AND used > 0
    ORDER BY expires_at ASC NULLS LAST
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_restore_student_credit
  AFTER UPDATE ON bookings
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status = 'confirmed')
  EXECUTE FUNCTION restore_student_credit();

-- ── Credits: prevent total < used on update ──────────────────────────────────

CREATE OR REPLACE FUNCTION validate_credits_total()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.total < NEW.used THEN
    RAISE EXCEPTION 'Cannot reduce total below used (total=%, used=%)', NEW.total, NEW.used;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_validate_credits_total
  BEFORE UPDATE ON student_credits
  FOR EACH ROW EXECUTE FUNCTION validate_credits_total();

-- ── Session: guard — only for confirmed/completed bookings ───────────────────

CREATE OR REPLACE FUNCTION guard_session()
RETURNS TRIGGER AS $$
DECLARE
  booking_status booking_status;
BEGIN
  SELECT status INTO booking_status FROM bookings WHERE id = NEW.booking_id;
  IF booking_status NOT IN ('confirmed', 'completed') THEN
    RAISE EXCEPTION 'Cannot create session for booking with status: %', booking_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_guard_session
  BEFORE INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION guard_session();

-- ── Session: auto-calculate actual_duration ──────────────────────────────────

CREATE OR REPLACE FUNCTION calc_actual_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.started_at IS NOT NULL AND NEW.ended_at IS NOT NULL THEN
    NEW.actual_duration = ROUND(EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) / 60);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_calc_actual_duration
  BEFORE INSERT OR UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION calc_actual_duration();

-- ── Messages: sync conversation last_message_at ──────────────────────────────

CREATE OR REPLACE FUNCTION sync_conv_ts()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_sync_conv_ts
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION sync_conv_ts();

-- ── Reviews: update teacher rating_avg ───────────────────────────────────────

CREATE OR REPLACE FUNCTION update_teacher_rating()
RETURNS TRIGGER AS $$
DECLARE
  t_id uuid;
BEGIN
  t_id := COALESCE(NEW.teacher_id, OLD.teacher_id);
  UPDATE teacher_profiles
  SET rating_avg = COALESCE(
    (SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE teacher_id = t_id),
    0
  )
  WHERE teacher_id = t_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_update_teacher_rating
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_teacher_rating();

-- ── Invoices: auto-generate invoice number ───────────────────────────────────

CREATE OR REPLACE FUNCTION gen_invoice_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.invoice_number := 'FURQAN-' || to_char(NOW(), 'YYYY') || '-' || LPAD(nextval('invoice_seq')::text, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER t_gen_invoice_number
  BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION gen_invoice_number();

-- ═════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_ijaza         ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_policies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_credits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_availability  ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_progress      ENABLE ROW LEVEL SECURITY;
ALTER TABLE recitation_errors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews               ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations     ENABLE ROW LEVEL SECURITY;

-- ── profiles ─────────────────────────────────────────────────────────────────

CREATE POLICY profiles_select ON profiles FOR SELECT USING (true);
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (auth.uid() = id);

-- ── teacher_profiles ─────────────────────────────────────────────────────────

CREATE POLICY tp_select ON teacher_profiles FOR SELECT USING (true);
CREATE POLICY tp_update ON teacher_profiles FOR UPDATE
  USING (auth.uid() = teacher_id OR is_admin());

-- ── teacher_ijaza ────────────────────────────────────────────────────────────

CREATE POLICY ijaza_select ON teacher_ijaza FOR SELECT USING (true);
CREATE POLICY ijaza_all    ON teacher_ijaza FOR ALL
  USING (auth.uid() = teacher_id OR is_admin());

-- ── refund_policies ──────────────────────────────────────────────────────────

CREATE POLICY rp_select ON refund_policies FOR SELECT USING (true);
CREATE POLICY rp_admin  ON refund_policies FOR ALL USING (is_admin());

-- ── payments ─────────────────────────────────────────────────────────────────

CREATE POLICY payments_select ON payments FOR SELECT
  USING (auth.uid() = student_id OR is_admin());

-- ── payment_transactions ─────────────────────────────────────────────────────

CREATE POLICY pt_select ON payment_transactions FOR SELECT USING (is_admin());

-- ── student_credits ──────────────────────────────────────────────────────────

CREATE POLICY credits_select ON student_credits FOR SELECT
  USING (auth.uid() = student_id);

-- ── teacher_availability ─────────────────────────────────────────────────────

CREATE POLICY ta_select ON teacher_availability FOR SELECT USING (true);
CREATE POLICY ta_all    ON teacher_availability FOR ALL
  USING (auth.uid() = teacher_id OR is_admin());

-- ── availability_exceptions (no RLS specified in schema — open for parties) ──

CREATE POLICY ae_select ON availability_exceptions FOR SELECT USING (true);
CREATE POLICY ae_all    ON availability_exceptions FOR ALL
  USING (auth.uid() = teacher_id OR is_admin());

-- ── bookings ─────────────────────────────────────────────────────────────────

CREATE POLICY bookings_select ON bookings FOR SELECT
  USING (auth.uid() = student_id OR auth.uid() = teacher_id OR is_admin());
CREATE POLICY bookings_insert ON bookings FOR INSERT
  WITH CHECK (auth.uid() = student_id OR is_admin());
CREATE POLICY bookings_update ON bookings FOR UPDATE
  USING (auth.uid() = student_id OR auth.uid() = teacher_id OR is_admin());

-- ── sessions ─────────────────────────────────────────────────────────────────

CREATE POLICY sessions_select ON sessions FOR SELECT
  USING (
    booking_id IN (
      SELECT id FROM bookings
      WHERE student_id = auth.uid() OR teacher_id = auth.uid()
    )
  );

-- ── conversations ────────────────────────────────────────────────────────────

CREATE POLICY conv_select ON conversations FOR SELECT
  USING (auth.uid() = student_id OR auth.uid() = teacher_id);
CREATE POLICY conv_insert ON conversations FOR INSERT
  WITH CHECK (auth.uid() = student_id OR auth.uid() = teacher_id);

-- ── messages ─────────────────────────────────────────────────────────────────

CREATE POLICY msg_select ON messages FOR SELECT
  USING (
    deleted_at IS NULL
    AND conversation_id IN (
      SELECT id FROM conversations
      WHERE student_id = auth.uid() OR teacher_id = auth.uid()
    )
  );
CREATE POLICY msg_insert ON messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND conversation_id IN (
      SELECT id FROM conversations
      WHERE student_id = auth.uid() OR teacher_id = auth.uid()
    )
  );
CREATE POLICY msg_update ON messages FOR UPDATE
  USING (auth.uid() = sender_id AND deleted_at IS NULL);

-- ── student_progress ─────────────────────────────────────────────────────────

CREATE POLICY progress_select ON student_progress FOR SELECT
  USING (auth.uid() = student_id OR auth.uid() = teacher_id OR is_admin());
CREATE POLICY progress_insert ON student_progress FOR INSERT
  WITH CHECK (auth.uid() = teacher_id OR is_admin());

-- ── recitation_errors ────────────────────────────────────────────────────────

CREATE POLICY errors_select ON recitation_errors FOR SELECT
  USING (
    progress_id IN (
      SELECT id FROM student_progress
      WHERE student_id = auth.uid() OR teacher_id = auth.uid()
    )
  );
CREATE POLICY errors_insert ON recitation_errors FOR INSERT
  WITH CHECK (
    progress_id IN (
      SELECT id FROM student_progress WHERE teacher_id = auth.uid()
    )
  );
CREATE POLICY errors_update ON recitation_errors FOR UPDATE
  USING (
    progress_id IN (
      SELECT id FROM student_progress WHERE teacher_id = auth.uid()
    )
  );

-- ── reviews ──────────────────────────────────────────────────────────────────

CREATE POLICY reviews_select ON reviews FOR SELECT USING (is_public = true);
CREATE POLICY reviews_insert ON reviews FOR INSERT
  WITH CHECK (
    auth.uid() = student_id
    AND (SELECT status FROM bookings WHERE id = booking_id) = 'completed'
  );
CREATE POLICY reviews_update_student ON reviews FOR UPDATE
  USING (auth.uid() = student_id);
CREATE POLICY reviews_update_teacher ON reviews FOR UPDATE
  USING (auth.uid() = teacher_id);

-- ── notifications ────────────────────────────────────────────────────────────

CREATE POLICY notif_all ON notifications FOR ALL USING (auth.uid() = user_id);

-- ── invoices ─────────────────────────────────────────────────────────────────

CREATE POLICY invoices_select ON invoices FOR SELECT
  USING (auth.uid() = student_id OR is_admin());

-- ── audit_log ────────────────────────────────────────────────────────────────

CREATE POLICY audit_select ON audit_log FOR SELECT USING (is_admin());

-- ── schema_migrations ────────────────────────────────────────────────────────

CREATE POLICY migrations_select ON schema_migrations FOR SELECT USING (is_admin());

-- ═════════════════════════════════════════════════════════════════════════════
-- REALTIME SUBSCRIPTIONS
-- ═════════════════════════════════════════════════════════════════════════════

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;

-- ═════════════════════════════════════════════════════════════════════════════
-- SEED DATA
-- ═════════════════════════════════════════════════════════════════════════════

INSERT INTO refund_policies (hours_before_min, hours_before_max, refund_percentage, description, is_active, sort_order) VALUES
  (48, NULL, 100.00, '48h+ → full refund',  true, 1),
  (24, 48,    50.00, '24-48h → 50% refund', true, 2),
  (0,  24,     0.00, '<24h → no refund',    true, 3);

INSERT INTO schema_migrations (version, applied_at, description, applied_by) VALUES
  ('v7.0.0', NOW(), 'Absolute Final — all triggers locked',           'system'),
  ('v8.0.0', NOW(), 'Domain Expert — Quran + Schema + Accounting',    'system');

-- ═════════════════════════════════════════════════════════════════════════════
-- DONE — 20 tables, 16 triggers, 22 RLS policies, 2 seed inserts
-- ═════════════════════════════════════════════════════════════════════════════
