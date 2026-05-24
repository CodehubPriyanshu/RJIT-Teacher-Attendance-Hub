-- Add per-record comments to attendance rows.
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS comment TEXT;

ALTER TABLE public.attendance_records_archive
  ADD COLUMN IF NOT EXISTS comment TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendance_records_comment_length_check'
      AND conrelid = 'public.attendance_records'::regclass
  ) THEN
    ALTER TABLE public.attendance_records
      ADD CONSTRAINT attendance_records_comment_length_check
      CHECK (char_length(comment) <= 500);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attendance_records_archive_comment_length_check'
      AND conrelid = 'public.attendance_records_archive'::regclass
  ) THEN
    ALTER TABLE public.attendance_records_archive
      ADD CONSTRAINT attendance_records_archive_comment_length_check
      CHECK (char_length(comment) <= 500);
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Authenticated update attendance_records_archive" ON public.attendance_records_archive;

CREATE POLICY "Authenticated update attendance_records_archive"
  ON public.attendance_records_archive
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

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
