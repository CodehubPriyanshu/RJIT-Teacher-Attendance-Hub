CREATE INDEX IF NOT EXISTS idx_attendance_records_first_name ON public.attendance_records (first_name);
CREATE INDEX IF NOT EXISTS idx_attendance_records_department ON public.attendance_records (department);
CREATE INDEX IF NOT EXISTS idx_attendance_records_attendance_date ON public.attendance_records (attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_late_minutes ON public.attendance_records (late_minutes);
CREATE INDEX IF NOT EXISTS idx_attendance_records_early_departure_minutes ON public.attendance_records (early_departure_minutes);
CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_id ON public.attendance_records (employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_status ON public.attendance_records (status);