-- =====================================================
-- RIT Attendance Hub - Complete Consolidated Schema
-- Generated from migrations 001-006
-- =====================================================
-- This is a single-file consolidation of all migrations. It is fully
-- idempotent (uses IF NOT EXISTS / CREATE OR REPLACE / DO blocks) so it
-- can be run against a fresh database or an existing one to bring it up
-- to the current schema.
--
-- Sections:
--   1. ENUMS & TYPES
--   2. USER ROLES TABLE
--   3. PROFILES TABLE
--   4. ATTENDANCE RECORDS TABLE (with comment column, archive, view, triggers)
--   5. HOLIDAYS TABLE
--   6. EMPLOYEE LEAVES TABLE
--   7. TRIGGERS & AUTH FUNCTIONS
--   8. HOLIDAY RPC FUNCTIONS
--   9. EMPLOYEE LEAVES RPC FUNCTIONS (v1 + v2)
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
-- 4b. ATTENDANCE ARCHIVE STORAGE
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
DROP POLICY IF EXISTS "Authenticated update attendance_records_archive" ON public.attendance_records_archive;

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

CREATE POLICY "Authenticated update attendance_records_archive"
  ON public.attendance_records_archive
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- attendance_records_all view (union of live + archive, includes comment)
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
  created_at,
  false AS archived,
  comment
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
  created_at,
  true AS archived,
  comment
FROM public.attendance_records_archive;

GRANT SELECT ON public.attendance_records_all TO authenticated;

-- When a row is updated/inserted in attendance_records, drop any matching
-- archive row for the same (employee_id, first_name, attendance_date).
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

-- Archive older rows when active table exceeds max_active_rows
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
-- 5. HOLIDAYS TABLE
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
-- 6. EMPLOYEE LEAVES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.employee_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  document_url TEXT,
  document_name TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employee_leaves_reason_length_check CHECK (char_length(reason) <= 500)
);

-- Add new columns (enhancement) safely
ALTER TABLE public.employee_leaves
  ADD COLUMN IF NOT EXISTS shift TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_status TEXT DEFAULT 'absent',
  ADD COLUMN IF NOT EXISTS leave_date DATE;

-- Backfill leave_date from start_date for legacy rows
UPDATE public.employee_leaves SET leave_date = start_date WHERE leave_date IS NULL;

-- Enforce NOT NULL on leave_date after backfill
ALTER TABLE public.employee_leaves ALTER COLUMN leave_date SET NOT NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_employee_leaves_employee_id ON public.employee_leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_start_date ON public.employee_leaves(start_date);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_end_date ON public.employee_leaves(end_date);

-- Unique constraint to prevent duplicate leaves for same employee on same date
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_leaves_employee_date_unique
  ON public.employee_leaves(employee_id, leave_date);

-- Enable RLS
ALTER TABLE public.employee_leaves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins all employee_leaves" ON public.employee_leaves;
DROP POLICY IF EXISTS "Authenticated read employee_leaves" ON public.employee_leaves;
DROP POLICY IF EXISTS "Authenticated insert employee_leaves" ON public.employee_leaves;
DROP POLICY IF EXISTS "Authenticated update employee_leaves" ON public.employee_leaves;
DROP POLICY IF EXISTS "Authenticated delete employee_leaves" ON public.employee_leaves;
DROP POLICY IF EXISTS "Authenticated all employee_leaves" ON public.employee_leaves;

-- Allow full CRUD for all authenticated users
CREATE POLICY "Authenticated all employee_leaves"
  ON public.employee_leaves
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_leaves TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;


-- =====================================================
-- 7. TRIGGERS & AUTH FUNCTIONS
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


-- =====================================================
-- 8. HOLIDAY RPC FUNCTIONS (bypass RLS)
-- =====================================================

-- 8a. Batch insert weekends / multiple holidays
CREATE OR REPLACE FUNCTION public.batch_insert_holidays(
  p_holidays JSONB
)
RETURNS SETOF public.holidays
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.holidays (holiday_date, holiday_name, holiday_type, status)
  SELECT
    (item->>'holiday_date')::DATE,
    item->>'holiday_name',
    COALESCE(item->>'holiday_type', 'Weekend Holiday'),
    COALESCE(item->>'status', 'Active')
  FROM jsonb_array_elements(p_holidays) AS item
  ON CONFLICT (holiday_date) DO NOTHING
  RETURNING *;
END;
$$;

-- 8b. Insert or update a single holiday
CREATE OR REPLACE FUNCTION public.upsert_holiday(
  p_holiday_date DATE,
  p_holiday_name TEXT,
  p_holiday_type TEXT DEFAULT 'College Holiday',
  p_description TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'Active',
  p_id UUID DEFAULT NULL
)
RETURNS SETOF public.holidays
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_id IS NOT NULL THEN
    RETURN QUERY
    UPDATE public.holidays
    SET
      holiday_date = p_holiday_date,
      holiday_name = p_holiday_name,
      holiday_type = p_holiday_type,
      description = p_description,
      status = p_status
    WHERE id = p_id
    RETURNING *;
  ELSE
    RETURN QUERY
    INSERT INTO public.holidays (holiday_date, holiday_name, holiday_type, description, status)
    VALUES (p_holiday_date, p_holiday_name, p_holiday_type, p_description, p_status)
    ON CONFLICT (holiday_date)
    DO UPDATE SET
      holiday_name = EXCLUDED.holiday_name,
      holiday_type = EXCLUDED.holiday_type,
      description = EXCLUDED.description,
      status = EXCLUDED.status
    RETURNING *;
  END IF;
END;
$$;

-- 8c. Delete a holiday
CREATE OR REPLACE FUNCTION public.delete_holiday(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.holidays WHERE id = p_id;
  RETURN FOUND;
END;
$$;

-- 8d. Toggle holiday status
CREATE OR REPLACE FUNCTION public.toggle_holiday_status(p_id UUID)
RETURNS SETOF public.holidays
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.holidays
  SET status = CASE WHEN status = 'Active' THEN 'Inactive' ELSE 'Active' END
  WHERE id = p_id
  RETURNING *;
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.batch_insert_holidays TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_holiday TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_holiday TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_holiday_status TO authenticated;


-- =====================================================
-- 9. EMPLOYEE LEAVES RPC FUNCTIONS (bypass RLS)
-- =====================================================

-- 9a. v1: Fetch all employee leaves
CREATE OR REPLACE FUNCTION public.fetch_employee_leaves()
RETURNS SETOF public.employee_leaves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.employee_leaves
  ORDER BY start_date DESC, created_at DESC;
END;
$$;

-- 9b. v1: Create a new employee leave (date range)
CREATE OR REPLACE FUNCTION public.create_employee_leave(
  p_employee_id TEXT,
  p_employee_name TEXT,
  p_leave_type TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_document_url TEXT DEFAULT NULL,
  p_document_name TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS SETOF public.employee_leaves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.employee_leaves (employee_id, employee_name, leave_type, start_date, end_date, document_url, document_name, reason)
  VALUES (p_employee_id, p_employee_name, p_leave_type, p_start_date, p_end_date, p_document_url, p_document_name, p_reason)
  RETURNING id INTO v_id;

  RETURN QUERY
  SELECT * FROM public.employee_leaves WHERE id = v_id;
END;
$$;

-- 9c. v1: Delete an employee leave
CREATE OR REPLACE FUNCTION public.delete_employee_leave(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.employee_leaves WHERE id = p_id;
  RETURN FOUND;
END;
$$;

-- 9d. v2: Check if attendance exists for an employee on a date.
--     Checks both attendance_records and attendance_records_archive (since
--     attendance_records_all is a union of both).
CREATE OR REPLACE FUNCTION public.check_attendance_for_leave(
  p_employee_id TEXT,
  p_leave_date DATE
)
RETURNS TABLE(
  has_attendance BOOLEAN,
  current_status TEXT,
  record_id UUID,
  source_table TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_id UUID;
  v_source TEXT;
BEGIN
  -- Try the live attendance_records table first
  SELECT ar.status, ar.id INTO v_status, v_id
  FROM public.attendance_records ar
  WHERE ar.employee_id = p_employee_id
    AND ar.attendance_date = p_leave_date
  LIMIT 1;

  IF FOUND THEN
    v_source := 'attendance_records';
    RETURN QUERY SELECT TRUE, v_status, v_id, v_source;
    RETURN;
  END IF;

  -- Fall back to archive table
  SELECT ara.status, ara.id INTO v_status, v_id
  FROM public.attendance_records_archive ara
  WHERE ara.employee_id = p_employee_id
    AND ara.attendance_date = p_leave_date
  LIMIT 1;

  IF FOUND THEN
    v_source := 'attendance_records_archive';
    RETURN QUERY SELECT TRUE, v_status, v_id, v_source;
    RETURN;
  END IF;

  -- No record found
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, NULL::TEXT;
END;
$$;

-- 9e. v2: Create employee leave with attendance integration.
--     Updates BOTH attendance_records and attendance_records_archive so
--     the attendance_records_all view always reflects leave.
CREATE OR REPLACE FUNCTION public.create_employee_leave_v2(
  p_employee_id TEXT,
  p_employee_name TEXT,
  p_leave_type TEXT,
  p_leave_date DATE,
  p_shift TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_document_url TEXT DEFAULT NULL,
  p_document_name TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL,
  p_previous_status TEXT DEFAULT 'absent'
)
RETURNS SETOF public.employee_leaves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_comment_text TEXT;
BEGIN
  v_comment_text := p_leave_type || COALESCE(' - ' || p_reason, '');

  -- Upsert the leave record (replace if same employee+date already exists)
  INSERT INTO public.employee_leaves (
    employee_id, employee_name, leave_type,
    start_date, end_date, leave_date,
    shift, reason, document_url, document_name,
    created_by, previous_status
  ) VALUES (
    p_employee_id, p_employee_name, p_leave_type,
    p_leave_date, p_leave_date, p_leave_date,
    p_shift, p_reason, p_document_url, p_document_name,
    p_created_by, p_previous_status
  )
  ON CONFLICT (employee_id, leave_date) DO UPDATE
    SET leave_type = EXCLUDED.leave_type,
        start_date = EXCLUDED.leave_date,
        end_date = EXCLUDED.leave_date,
        shift = EXCLUDED.shift,
        reason = EXCLUDED.reason,
        document_url = EXCLUDED.document_url,
        document_name = EXCLUDED.document_name,
        previous_status = EXCLUDED.previous_status
  RETURNING id INTO v_id;

  -- Update live attendance_records
  UPDATE public.attendance_records
  SET
    status = 'leave',
    late_minutes = 0,
    early_departure_minutes = 0,
    extra_work_minutes = 0,
    comment = v_comment_text
  WHERE employee_id = p_employee_id
    AND attendance_date = p_leave_date;

  -- Update archive table too so the view reflects the change
  UPDATE public.attendance_records_archive
  SET
    status = 'leave',
    late_minutes = 0,
    early_departure_minutes = 0,
    extra_work_minutes = 0,
    comment = v_comment_text
  WHERE employee_id = p_employee_id
    AND attendance_date = p_leave_date;

  RETURN QUERY
  SELECT * FROM public.employee_leaves WHERE id = v_id;
END;
$$;

-- 9f. v2: Update employee leave (edit)
CREATE OR REPLACE FUNCTION public.update_employee_leave(
  p_id UUID,
  p_leave_type TEXT DEFAULT NULL,
  p_leave_date DATE DEFAULT NULL,
  p_shift TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_document_url TEXT DEFAULT NULL,
  p_document_name TEXT DEFAULT NULL
)
RETURNS SETOF public.employee_leaves
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_leave_date DATE;
  v_old_leave_type TEXT;
  v_old_reason TEXT;
  v_employee_id TEXT;
  v_old_previous_status TEXT;
  v_comment_text TEXT;
BEGIN
  -- Get current values
  SELECT leave_date, leave_type, reason, employee_id, previous_status
  INTO v_old_leave_date, v_old_leave_type, v_old_reason, v_employee_id, v_old_previous_status
  FROM public.employee_leaves WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave record not found';
  END IF;

  -- Update the leave record
  UPDATE public.employee_leaves
  SET
    leave_type = COALESCE(p_leave_type, leave_type),
    leave_date = COALESCE(p_leave_date, leave_date),
    start_date = COALESCE(p_leave_date, start_date),
    end_date = COALESCE(p_leave_date, end_date),
    shift = COALESCE(p_shift, shift),
    reason = COALESCE(p_reason, reason),
    document_url = COALESCE(p_document_url, document_url),
    document_name = COALESCE(p_document_name, document_name)
  WHERE id = p_id;

  v_comment_text := COALESCE(p_leave_type, v_old_leave_type) ||
                    COALESCE(' - ' || COALESCE(p_reason, v_old_reason), '');

  -- If the date changed, restore the old date's attendance and update the new date
  IF p_leave_date IS NOT NULL AND p_leave_date <> v_old_leave_date THEN
    -- Restore old date (use previous_status)
    UPDATE public.attendance_records
    SET
      status = COALESCE(v_old_previous_status, 'absent'),
      comment = NULL
    WHERE employee_id = v_employee_id
      AND attendance_date = v_old_leave_date;

    UPDATE public.attendance_records_archive
    SET
      status = COALESCE(v_old_previous_status, 'absent'),
      comment = NULL
    WHERE employee_id = v_employee_id
      AND attendance_date = v_old_leave_date;

    -- Update new date
    UPDATE public.attendance_records
    SET
      status = 'leave',
      late_minutes = 0,
      early_departure_minutes = 0,
      extra_work_minutes = 0,
      comment = v_comment_text
    WHERE employee_id = v_employee_id
      AND attendance_date = p_leave_date;

    UPDATE public.attendance_records_archive
    SET
      status = 'leave',
      late_minutes = 0,
      early_departure_minutes = 0,
      extra_work_minutes = 0,
      comment = v_comment_text
    WHERE employee_id = v_employee_id
      AND attendance_date = p_leave_date;
  ELSE
    -- Same date: just update the comment
    UPDATE public.attendance_records
    SET comment = v_comment_text
    WHERE employee_id = v_employee_id
      AND attendance_date = v_old_leave_date;

    UPDATE public.attendance_records_archive
    SET comment = v_comment_text
    WHERE employee_id = v_employee_id
      AND attendance_date = v_old_leave_date;
  END IF;

  RETURN QUERY
  SELECT * FROM public.employee_leaves WHERE id = p_id;
END;
$$;

-- 9g. v2: Delete employee leave with attendance restoration
CREATE OR REPLACE FUNCTION public.delete_employee_leave_v2(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id TEXT;
  v_leave_date DATE;
  v_previous_status TEXT;
BEGIN
  -- Get leave details before deleting
  SELECT employee_id, leave_date, previous_status
  INTO v_employee_id, v_leave_date, v_previous_status
  FROM public.employee_leaves WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Delete the leave record
  DELETE FROM public.employee_leaves WHERE id = p_id;

  -- Restore attendance record (live)
  UPDATE public.attendance_records
  SET
    status = COALESCE(v_previous_status, 'absent'),
    late_minutes = 0,
    early_departure_minutes = 0,
    extra_work_minutes = 0,
    comment = NULL
  WHERE employee_id = v_employee_id
    AND attendance_date = v_leave_date
    AND status = 'leave';

  -- Restore archive too
  UPDATE public.attendance_records_archive
  SET
    status = COALESCE(v_previous_status, 'absent'),
    late_minutes = 0,
    early_departure_minutes = 0,
    extra_work_minutes = 0,
    comment = NULL
  WHERE employee_id = v_employee_id
    AND attendance_date = v_leave_date
    AND status = 'leave';

  RETURN TRUE;
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public.fetch_employee_leaves TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_leave TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_leave TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_attendance_for_leave TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_leave_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_leave TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_leave_v2 TO authenticated;


-- =====================================================
-- END OF SCHEMA
-- =====================================================
