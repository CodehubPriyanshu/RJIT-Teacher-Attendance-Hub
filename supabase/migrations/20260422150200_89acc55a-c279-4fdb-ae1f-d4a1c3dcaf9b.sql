-- Unique constraint for upsert on attendance_records
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_unique_emp_name_date
  ON public.attendance_records (employee_id, first_name, attendance_date);

-- Helpful indexes for filtering large datasets
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON public.attendance_records (attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_department ON public.attendance_records (department);
CREATE INDEX IF NOT EXISTS idx_attendance_records_late ON public.attendance_records (late_minutes);
CREATE INDEX IF NOT EXISTS idx_attendance_records_early ON public.attendance_records (early_departure_minutes);