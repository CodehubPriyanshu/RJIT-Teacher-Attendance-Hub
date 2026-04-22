-- New table for uploaded attendance rows
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_number integer,
  employee_id text NOT NULL,
  first_name text NOT NULL,
  department text,
  attendance_date date NOT NULL,
  weekday text,
  first_punch time,
  last_punch time,
  total_time text,
  late_minutes integer NOT NULL DEFAULT 0,
  early_departure_minutes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'present',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ar_employee_id ON public.attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_ar_date ON public.attendance_records(attendance_date);
CREATE INDEX IF NOT EXISTS idx_ar_department ON public.attendance_records(department);
CREATE INDEX IF NOT EXISTS idx_ar_emp_date ON public.attendance_records(employee_id, attendance_date);

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins all attendance_records"
  ON public.attendance_records
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));