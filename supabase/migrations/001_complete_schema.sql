-- =====================================================
-- RIT Attendance Hub - Complete Database Schema
-- =====================================================

-- =====================================================
-- 1. ENUMS & TYPES
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'user');
  END IF;
END;
$$;

-- =====================================================
-- 2. USER ROLES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Helper function to check user roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- RLS Policies for user_roles
DROP POLICY IF EXISTS "Users see own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- =====================================================
-- 3. PROFILES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  full_name TEXT,
  phone TEXT,
  department TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins delete profiles" ON public.profiles;

CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete profiles" ON public.profiles
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;

CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();

-- =====================================================
-- 4. ATTENDANCE RECORDS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_number INTEGER,
  employee_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  department TEXT,
  attendance_date DATE NOT NULL,
  weekday TEXT,
  first_punch TIME,
  last_punch TIME,
  total_time TEXT,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_departure_minutes INTEGER NOT NULL DEFAULT 0,
  extra_work_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'present',
  comment TEXT CHECK (char_length(comment) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for attendance_records
CREATE INDEX IF NOT EXISTS idx_ar_employee_id ON public.attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_ar_date ON public.attendance_records(attendance_date);
CREATE INDEX IF NOT EXISTS idx_ar_department ON public.attendance_records(department);
CREATE INDEX IF NOT EXISTS idx_ar_emp_date ON public.attendance_records(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_first_name ON public.attendance_records (first_name);
CREATE INDEX IF NOT EXISTS idx_attendance_records_attendance_date ON public.attendance_records (attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_late_minutes ON public.attendance_records (late_minutes);
CREATE INDEX IF NOT EXISTS idx_attendance_records_early_departure_minutes ON public.attendance_records (early_departure_minutes);
CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_id ON public.attendance_records (employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_status ON public.attendance_records (status);
CREATE INDEX IF NOT EXISTS idx_attendance_records_department ON public.attendance_records (department);
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON public.attendance_records (attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_late ON public.attendance_records (late_minutes);
CREATE INDEX IF NOT EXISTS idx_attendance_records_early ON public.attendance_records (early_departure_minutes);

-- Unique constraint for upsert operations
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_unique_emp_name_date
  ON public.attendance_records (employee_id, first_name, attendance_date);

-- Comment for extra_work_minutes
COMMENT ON COLUMN public.attendance_records.extra_work_minutes IS 'Overtime minutes worked after 17:00';

-- RLS for attendance_records
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins all attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Authenticated read attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Authenticated insert attendance_records" ON public.attendance_records;
DROP POLICY IF EXISTS "Authenticated update attendance_records" ON public.attendance_records;

CREATE POLICY "Admins all attendance_records"
  ON public.attendance_records
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read attendance_records"
  ON public.attendance_records
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated insert attendance_records"
  ON public.attendance_records
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated update attendance_records"
  ON public.attendance_records
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 5. ATTENDANCE ARCHIVE STORAGE
-- =====================================================
-- Keeps the newest 5000 records in attendance_records and moves older rows
-- into attendance_records_archive. Frontend reads use attendance_records_all.

CREATE TABLE IF NOT EXISTS public.attendance_records_archive (
  LIKE public.attendance_records INCLUDING DEFAULTS INCLUDING CONSTRAINTS
);

ALTER TABLE public.attendance_records_archive ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_attendance_records_archive_employee_id
  ON public.attendance_records_archive(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_archive_date
  ON public.attendance_records_archive(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_archive_department
  ON public.attendance_records_archive(department);
CREATE INDEX IF NOT EXISTS idx_attendance_records_archive_emp_date
  ON public.attendance_records_archive(employee_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_archive_status
  ON public.attendance_records_archive(status);
CREATE INDEX IF NOT EXISTS idx_attendance_records_archive_first_name
  ON public.attendance_records_archive(first_name);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_archive_unique_emp_name_date
  ON public.attendance_records_archive(employee_id, first_name, attendance_date);

DROP POLICY IF EXISTS "Admins all attendance_records_archive" ON public.attendance_records_archive;
DROP POLICY IF EXISTS "Authenticated read attendance_records_archive" ON public.attendance_records_archive;

CREATE POLICY "Admins all attendance_records_archive"
  ON public.attendance_records_archive
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read attendance_records_archive"
  ON public.attendance_records_archive
  FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE VIEW public.attendance_records_all
WITH (security_invoker = true) AS
SELECT
  id,
  record_number,
  employee_id,
  first_name,
  department,
  attendance_date,
  weekday,
  first_punch,
  last_punch,
  total_time,
  late_minutes,
  early_departure_minutes,
  extra_work_minutes,
  status,
  comment,
  created_at,
  false AS archived
FROM public.attendance_records
UNION ALL
SELECT
  id,
  record_number,
  employee_id,
  first_name,
  department,
  attendance_date,
  weekday,
  first_punch,
  last_punch,
  total_time,
  late_minutes,
  early_departure_minutes,
  extra_work_minutes,
  status,
  comment,
  created_at,
  true AS archived
FROM public.attendance_records_archive;

GRANT SELECT ON public.attendance_records_all TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_matching_attendance_archive_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.attendance_records_archive
  WHERE employee_id = NEW.employee_id
    AND first_name = NEW.first_name
    AND attendance_date = NEW.attendance_date;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_remove_matching_attendance_archive_record ON public.attendance_records;

CREATE TRIGGER trg_remove_matching_attendance_archive_record
  BEFORE INSERT OR UPDATE OF employee_id, first_name, attendance_date ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.remove_matching_attendance_archive_record();

CREATE OR REPLACE FUNCTION public.archive_attendance_records(max_active_rows integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  active_count integer;
  rows_to_archive integer;
  deleted_count integer;
BEGIN
  IF max_active_rows < 1 THEN
    RAISE EXCEPTION 'max_active_rows must be positive';
  END IF;

  SELECT count(*) INTO active_count
  FROM public.attendance_records;

  rows_to_archive := active_count - max_active_rows;
  IF rows_to_archive <= 0 THEN
    RETURN 0;
  END IF;

  DROP TABLE IF EXISTS pg_temp.attendance_archive_candidates;

  CREATE TEMP TABLE attendance_archive_candidates
  ON COMMIT DROP
  AS
  SELECT *
  FROM public.attendance_records
  ORDER BY attendance_date ASC, created_at ASC, id ASC
  LIMIT rows_to_archive;

  INSERT INTO public.attendance_records_archive (
    id,
    record_number,
    employee_id,
    first_name,
    department,
    attendance_date,
    weekday,
    first_punch,
    last_punch,
    total_time,
    late_minutes,
    early_departure_minutes,
    extra_work_minutes,
    status,
    comment,
    created_at
  )
  SELECT
    id,
    record_number,
    employee_id,
    first_name,
    department,
    attendance_date,
    weekday,
    first_punch,
    last_punch,
    total_time,
    late_minutes,
    early_departure_minutes,
    extra_work_minutes,
    status,
    comment,
    created_at
  FROM attendance_archive_candidates
  ON CONFLICT (employee_id, first_name, attendance_date) DO UPDATE SET
    id = EXCLUDED.id,
    record_number = EXCLUDED.record_number,
    department = EXCLUDED.department,
    weekday = EXCLUDED.weekday,
    first_punch = EXCLUDED.first_punch,
    last_punch = EXCLUDED.last_punch,
    total_time = EXCLUDED.total_time,
    late_minutes = EXCLUDED.late_minutes,
    early_departure_minutes = EXCLUDED.early_departure_minutes,
    extra_work_minutes = EXCLUDED.extra_work_minutes,
    status = EXCLUDED.status,
    comment = EXCLUDED.comment,
    created_at = EXCLUDED.created_at;

  DELETE FROM public.attendance_records ar
  USING attendance_archive_candidates c
  WHERE ar.id = c.id
    AND EXISTS (
      SELECT 1
      FROM public.attendance_records_archive aa
      WHERE aa.employee_id = c.employee_id
        AND aa.first_name = c.first_name
        AND aa.attendance_date = c.attendance_date
    );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count <> (SELECT count(*) FROM attendance_archive_candidates) THEN
    RAISE EXCEPTION 'Archive safety check failed: expected %, deleted %',
      (SELECT count(*) FROM attendance_archive_candidates),
      deleted_count;
  END IF;

  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_attendance_records_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.archive_attendance_records(5000);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_archive_attendance_records ON public.attendance_records;

CREATE TRIGGER trg_archive_attendance_records
  AFTER INSERT OR UPDATE ON public.attendance_records
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.archive_attendance_records_trigger();

-- =====================================================
-- 6. HOLIDAYS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date DATE NOT NULL UNIQUE,
  holiday_name TEXT NOT NULL,
  holiday_type TEXT NOT NULL DEFAULT 'College Holiday',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for holidays
CREATE INDEX IF NOT EXISTS idx_holidays_holiday_date ON public.holidays (holiday_date);
CREATE INDEX IF NOT EXISTS idx_holidays_status ON public.holidays (status);

-- RLS for holidays
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins all holidays" ON public.holidays;
DROP POLICY IF EXISTS "Authenticated read holidays" ON public.holidays;

CREATE POLICY "Admins all holidays"
  ON public.holidays
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated read holidays"
  ON public.holidays
  FOR SELECT
  TO authenticated
  USING (true);

-- =====================================================
-- 7. TRIGGERS & FUNCTIONS
-- =====================================================

-- Auto-grant admin role to first signup
CREATE OR REPLACE FUNCTION public.handle_first_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created 
  AFTER INSERT ON auth.users 
  FOR EACH ROW EXECUTE FUNCTION public.handle_first_user();
